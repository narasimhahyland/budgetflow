#!/usr/bin/env node
// Runs a BudgetFlow guard hook from .cursor/hooks/ inside Claude Code.
//
// The guards live in .cursor/hooks/ and stay the single source of truth. This bridge translates
// Claude Code's hook payload into the Cursor payload the guard expects, runs the guard as a child
// process, and translates its verdict back into Claude Code's JSON output schema.
//
//   node .claude/hooks/bridge.mjs <guard-name>
//
// Internal errors exit 1, which Claude Code treats as a failed hook that lets the action proceed,
// matching the fail-open convention the Cursor guards already follow.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const guard = process.argv[2];
const GUARDS = new Set([
  'guard-shell',
  'guard-read',
  'guard-tool',
  'guard-prompt',
  'format',
  'stop-summary',
]);
if (!GUARDS.has(guard)) {
  process.stderr.write(`bridge: unknown guard "${guard}"\n`);
  process.exit(1);
}

/** Workspace roots the guards reason about: the project root, plus the checkout Claude is working in. */
function roots(input) {
  const cwd = input.cwd || process.cwd();
  const git = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 3000,
  });
  return [
    ...new Set(
      [process.env.CLAUDE_PROJECT_DIR, repoRoot, git.status === 0 ? git.stdout.trim() : null]
        .filter(Boolean)
        .map((r) => path.resolve(r)),
    ),
  ];
}

const MAX_SCAN = 5 * 1024 * 1024;

/**
 * Claude Code's PreToolUse payload for Read carries only the path, while the Cursor guard also scans
 * the content. The bridge reads the file itself so the secret scan still runs before the model sees it.
 */
function readContent(file) {
  try {
    if (!file || /[\\/]node_modules[\\/]/.test(file)) return '';
    if (statSync(file).size > MAX_SCAN) return '';
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function toCursorInput(guardName, input) {
  const workspace_roots = roots(input);
  const cwd = input.cwd || workspace_roots[0];
  const toolInput = input.tool_input ?? {};
  switch (guardName) {
    case 'guard-shell':
      return { command: String(toolInput.command ?? ''), cwd, workspace_roots };
    case 'guard-read': {
      const file_path = String(toolInput.file_path ?? toolInput.notebook_path ?? '');
      return { file_path, content: readContent(file_path), workspace_roots };
    }
    case 'guard-tool':
      return { tool_name: input.tool_name, tool_input: toolInput, cwd, workspace_roots };
    case 'guard-prompt':
      return { prompt: String(input.prompt ?? '') };
    case 'format':
      return { file_path: String(toolInput.file_path ?? ''), workspace_roots };
    case 'stop-summary':
      return {
        status: 'completed',
        conversation_id: input.session_id,
        loop_count: input.stop_hook_active ? 1 : 0,
        workspace_roots,
      };
    default:
      return {};
  }
}

/**
 * Maps a Cursor verdict to Claude Code's schema. A Cursor `allow` means "this guard has no objection",
 * not "skip the permission prompt", so it maps to no output rather than permissionDecision: allow,
 * which would wave the call past Claude Code's own permission checks.
 */
function toClaudeOutput(guardName, event, verdict) {
  const reason = verdict?.agent_message || verdict?.user_message;
  if (guardName === 'guard-prompt') {
    return verdict?.continue === false ? { decision: 'block', reason } : undefined;
  }
  if (guardName === 'stop-summary') {
    return verdict?.followup_message
      ? { decision: 'block', reason: verdict.followup_message }
      : undefined;
  }
  if (verdict?.permission === 'deny' || verdict?.permission === 'ask') {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: verdict.permission,
        permissionDecisionReason: reason,
      },
    };
  }
  return undefined;
}

try {
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const script = path.join(repoRoot, '.cursor', 'hooks', `${guard}.mjs`);
  const run = spawnSync(process.execPath, [script], {
    input: JSON.stringify(toCursorInput(guard, input)),
    encoding: 'utf8',
    timeout: 25000,
    env: { ...process.env, CURSOR_PROJECT_DIR: repoRoot },
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || `bridge: ${guard} exited ${run.status}\n`);
    process.exit(1);
  }
  const verdict = run.stdout.trim() ? JSON.parse(run.stdout) : {};
  const output = toClaudeOutput(guard, input.hook_event_name, verdict);
  if (output) process.stdout.write(JSON.stringify(output));
  process.exit(0);
} catch (err) {
  process.stderr.write(`bridge (${guard}) error: ${err?.stack ?? err}\n`);
  process.exit(1);
}
