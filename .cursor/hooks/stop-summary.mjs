// stop: writes a short run summary to tmp/agent-runs/ (gitignored).
// Optional nudge: with BF_STOP_NUDGE=1 or a tmp/stop-nudge file, an agent that changed source
// under apps/ or libs/ without touching functional tests or evidence gets one follow-up asking for /functional-check.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runHook, workspaceRoots } from './lib.mjs';

runHook((input) => {
  const root = workspaceRoots(input)[0];
  if (!root || input.status !== 'completed') return {};
  const git = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (git.status !== 0) return {};

  const files = git.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).split(' -> ').pop());
  const functional = (f) => /^apps\/(api-e2e|web-e2e)\//.test(f) || f.startsWith('evidence/');
  const source = files.filter((f) => /^(apps|libs)\/.+\.(ts|html|scss)$/.test(f) && !functional(f));
  const checks = files.filter(functional);

  const notes = [];
  if (source.length && !checks.length) notes.push('source changed but no functional test or evidence changed');

  const dir = path.join(root, 'tmp', 'agent-runs');
  mkdirSync(dir, { recursive: true });
  const id = String(input.conversation_id ?? 'unknown').slice(0, 8);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    path.join(dir, `${stamp}-${id}.md`),
    [
      `# Agent run ${id} (${input.status}, loop ${input.loop_count ?? 0})`,
      '',
      `Changed files (${files.length}):`,
      ...files.map((f) => `- ${f}`),
      '',
      notes.length ? `Attention: ${notes.join('; ')}.` : 'No hygiene warnings.',
      '',
    ].join('\n'),
  );

  const nudge = process.env.BF_STOP_NUDGE === '1' || existsSync(path.join(root, 'tmp', 'stop-nudge'));
  if (nudge && (input.loop_count ?? 0) === 0 && notes.length) {
    return {
      followup_message: `Before finishing: ${notes.join('; ')}. Run /functional-check for this change (local stack, the feature end to end as the relevant role, business outcome asserted, evidence under evidence/), then report the results. If no functional check applies, say why.`,
    };
  }
  return {};
});
