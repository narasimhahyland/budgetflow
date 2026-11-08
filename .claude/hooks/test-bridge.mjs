// Exercises the Claude Code bridge with real Claude Code hook payloads, so a guard that stops firing
// after a payload or schema change is caught here rather than in a session.
// Run: sh .claude/hooks/test-bridge.sh   (no dependencies; creates and deletes a temp git repo)
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(hooksDir, '..', '..');
const bridge = path.join(hooksDir, 'bridge.mjs');

// Fake credentials are assembled at runtime so this file never contains a literal token.
const fakeNpmToken = ['np', 'm_', 'Z9'.repeat(18)].join('');

// The sandbox must not live under an OS temp dir: the guards deliberately allow deletes there.
mkdirSync(path.join(projectRoot, 'tmp'), { recursive: true });
const sandbox = mkdtempSync(path.join(projectRoot, 'tmp', 'bridge-sandbox-'));
const repo = path.join(sandbox, 'repo');
const home = path.join(sandbox, 'home');
mkdirSync(repo);
mkdirSync(home, { recursive: true });
writeFileSync(path.join(home, '.npmrc'), `//registry.npmjs.org/:_authToken=${fakeNpmToken}\n`);

const git = (...args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};
git('init', '-q', '-b', 'main');
git(
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@example.com',
  'commit',
  '-q',
  '--allow-empty',
  '-m',
  'init',
);

function run(guard, payload) {
  const r = spawnSync(process.execPath, [bridge, guard], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo, BF_STOP_NUDGE: '' },
    timeout: 30000,
  });
  let json = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    json = 'INVALID';
  }
  return { code: r.status, json };
}

const results = [];
function expect(name, actual, expected) {
  const ok = actual === expected;
  results.push({ ok, name, detail: ok ? '' : `expected ${expected}, got ${actual}` });
}

const common = { session_id: 'bridge-test', cwd: repo, permission_mode: 'default' };
const decision = (out) => out.json?.hookSpecificOutput?.permissionDecision ?? 'allow';

const bash = (command) =>
  decision(
    run('guard-shell', {
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
  );

// --- PreToolUse / Bash ------------------------------------------------------
expect('bash: ordinary command allowed', bash('npm ci'), 'allow');
expect('bash: push to a feature branch allowed', bash('git push -u origin feat/budgets'), 'allow');
expect('bash: force push to main denied', bash('git push --force origin main'), 'deny');
expect('bash: reading ~/.npmrc denied', bash('cat ~/.npmrc'), 'deny');
expect('bash: printing a token denied', bash('echo $NODE_AUTH_TOKEN'), 'deny');
expect('bash: gh auth token denied', bash('gh auth token'), 'deny');
expect('bash: drizzle-kit push denied', bash('npx drizzle-kit push'), 'deny');
expect('bash: rm outside the repository denied', bash('rm -rf /Users/someone/notes'), 'deny');
expect('bash: rm inside the repository allowed', bash('rm -rf dist'), 'allow');
expect('bash: printenv asks', bash('printenv'), 'ask');
expect(
  'bash: shell output is valid JSON',
  run('guard-shell', {
    ...common,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat ~/.npmrc' },
  }).json?.hookSpecificOutput?.hookEventName,
  'PreToolUse',
);

// --- PreToolUse / Read ------------------------------------------------------
const read = (file) =>
  decision(
    run('guard-read', {
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: file },
    }),
  );
expect('read: ~/.npmrc denied', read(path.join(home, '.npmrc')), 'deny');
expect('read: a source file allowed', read(path.join(repo, 'README.md')), 'allow');

// The bridge reads content itself, because Claude Code's Read payload carries only the path.
const secretFile = path.join(repo, 'notes.txt');
writeFileSync(secretFile, `token: ${fakeNpmToken}\n`);
expect('read: content scan still denies a file holding a token', read(secretFile), 'deny');
rmSync(secretFile);

// --- PreToolUse / Write, Grep -----------------------------------------------
const tool = (tool_name, tool_input) =>
  decision(run('guard-tool', { ...common, hook_event_name: 'PreToolUse', tool_name, tool_input }));
expect(
  'write: a token in new content denied',
  tool('Write', { file_path: path.join(repo, 'a.ts'), content: `const t = "${fakeNpmToken}";` }),
  'deny',
);
expect(
  'write: ordinary content allowed',
  tool('Write', { file_path: path.join(repo, 'a.ts'), content: 'export const a = 1;' }),
  'allow',
);
expect(
  'grep: searching the home directory denied',
  tool('Grep', { path: home, pattern: 'x' }),
  'deny',
);

// --- UserPromptSubmit -------------------------------------------------------
const prompt = (text) =>
  run('guard-prompt', { ...common, hook_event_name: 'UserPromptSubmit', prompt: text }).json
    ?.decision ?? 'allow';
expect('prompt: ordinary prompt allowed', prompt('Add a budget screen'), 'allow');
expect('prompt: a pasted token is blocked', prompt(`use ${fakeNpmToken} please`), 'block');

// --- PostToolUse and Stop ---------------------------------------------------
const formatted = run('format', {
  ...common,
  hook_event_name: 'PostToolUse',
  tool_name: 'Write',
  tool_input: { file_path: path.join(repo, 'a.ts') },
});
expect('format: exits cleanly without Prettier installed', formatted.code, 0);
expect('format: prints nothing', formatted.json, null);

const stop = run('stop-summary', { ...common, hook_event_name: 'Stop', stop_hook_active: false });
expect('stop: exits cleanly', stop.code, 0);
expect('stop: does not block by default', stop.json, null);

// --- robustness -------------------------------------------------------------
const broken = spawnSync(process.execPath, [bridge, 'guard-shell'], {
  cwd: repo,
  input: '{not json',
  encoding: 'utf8',
  env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo },
});
expect('robust: invalid input fails open (exit 1)', broken.status, 1);
expect('robust: invalid input prints nothing', broken.stdout.trim(), '');
const unknown = spawnSync(process.execPath, [bridge, 'not-a-guard'], {
  input: '{}',
  encoding: 'utf8',
});
expect('robust: unknown guard name fails open', unknown.status, 1);

rmSync(sandbox, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\nbridge tests: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
