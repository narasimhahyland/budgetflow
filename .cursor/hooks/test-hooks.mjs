// Exercises every BudgetFlow hook with sample payloads through the same command path hooks.json uses.
// Run: sh .cursor/hooks/test-hooks.sh   (no dependencies; creates and deletes a temp git repo)
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(hooksDir, '..', '..');
const shim = path.join(hooksDir, 'node.sh');

// Fake credentials are assembled at runtime so this file never contains a literal token.
const fake = {
  github: ['gh', 'p_', 'A1b2'.repeat(9)].join(''),
  githubPat: ['github', '_pat_', 'x'.repeat(22), '_', 'Y'.repeat(59)].join(''),
  npm: ['np', 'm_', 'Z9'.repeat(18)].join(''),
};

// The sandbox must not live under an OS temp dir: the guards deliberately allow deletes there.
mkdirSync(path.join(projectRoot, 'tmp'), { recursive: true });
const sandbox = mkdtempSync(path.join(projectRoot, 'tmp', 'hook-sandbox-'));
const repo = path.join(sandbox, 'repo');
const home = path.join(sandbox, 'home');
mkdirSync(repo);
mkdirSync(path.join(home, '.ssh'), { recursive: true });

const sh = (cmd, args, cwd = repo) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
sh('git', ['init', '-q', '-b', 'main']);
sh('git', [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@example.com',
  'commit',
  '-q',
  '--allow-empty',
  '-m',
  'init',
]);

function run(script, payload, env = {}) {
  const r = spawnSync('sh', [shim, path.join(hooksDir, script)], {
    cwd: projectRoot,
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CURSOR_PROJECT_DIR: repo, BF_STOP_NUDGE: '', ...env },
    timeout: 30000,
  });
  let json = null;
  try {
    json = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {
    json = 'INVALID';
  }
  return { code: r.status, json, stderr: r.stderr };
}

const results = [];
function expect(name, actual, expected) {
  const ok = actual === expected;
  results.push({ ok, name, detail: ok ? '' : `expected ${expected}, got ${actual}` });
}

const base = { workspace_roots: [repo], hook_event_name: 'test', conversation_id: 'test-run-0001' };
const shell = (command, cwd = repo) =>
  run('guard-shell.mjs', { ...base, command, cwd }).json?.permission;

// --- beforeShellExecution ---------------------------------------------------
const allowShell = [
  'npm ci',
  'git status',
  'cat .npmrc',
  'rm -rf dist coverage',
  'rm -f /tmp/bf-hook-test.json',
  'git push -u origin feat/budgets',
  'git push --force-with-lease origin agent/wave1-budgets',
  'echo ${#NODE_AUTH_TOKEN}',
  'npm whoami --registry=https://npm.pkg.github.com',
  'git commit -m "docs: explain the -n flag"',
  'env NX_DAEMON=false npx nx test web',
  'npm config list',
  'npx drizzle-kit generate',
  'docker compose -p bf-x -f infra/compose.yaml ps',
  'docker compose down',
  'scripts/stack.sh reset',
  'ls -la',
  'git add .cursor/rules/testing-functional.mdc',
  'npx nx run-many -t lint typecheck build',
  'node scripts/visual/capture.mjs --screens apps/web-e2e/visual/screens.json --out tmp/vqa',
  'npm run e2e:update-snapshots',
  'scripts/visual/pw-docker.sh npx playwright test -c apps/web-e2e/playwright.config.ts --update-snapshots',
  'npx playwright test -c apps/api-e2e/playwright.config.ts',
];
for (const c of allowShell) expect(`shell allow: ${c}`, shell(c), 'allow');

const denyShell = [
  'cat ~/.npmrc',
  'cat $HOME/.npmrc',
  'cat "${HOME}/.npmrc"',
  'grep authToken /Users/someone/.npmrc',
  'cp ~/.npmrc /tmp/npmrc-copy',
  `node -e "console.log(require('fs').readFileSync(require('os').homedir()+'/.npmrc','utf8'))"`,
  'echo $(cat ~/.npmrc)',
  `sh -c 'cat ~/.npmrc'`,
  'cat ~/.ssh/id_ed25519',
  'npm config get //npm.pkg.github.com/:_authToken',
  'echo $NODE_AUTH_TOKEN',
  'echo "token=${SATORI_PACKAGES_TOKEN}"',
  'printenv GITHUB_TOKEN',
  'gh auth token',
  'git push --force origin main',
  'git push -f',
  'git push origin +main',
  'git push origin --delete main',
  'git push --force origin HEAD',
  'git -C . push --force-with-lease origin main:main',
  'rm -rf ~',
  'rm -rf /',
  'rm -rf ../somewhere-else',
  `rm -rf ${path.join(home, 'Documents')}`,
  'find ~ -name node_modules -exec rm -rf {} +',
  `rm -rf ${repo}`,
  'npx drizzle-kit push',
  'cd libs/api/db && npx drizzle-kit push --force',
];
for (const c of denyShell) expect(`shell deny: ${c}`, shell(c), 'deny');

const askShell = [
  'env',
  'printenv',
  'git commit --no-verify -m "wip"',
  'git reset --hard',
  'rm -rf "$BUILD_DIR"',
  'gh secret set SATORI_PACKAGES_TOKEN',
  'docker compose -f infra/compose.yaml down -v',
  'docker-compose down --volumes',
  'docker volume prune -f',
  'docker system prune -a',
  'npx drizzle-kit drop',
  'npx playwright test -c apps/web-e2e/playwright.config.ts --update-snapshots',
  'npx playwright test --project=visual-light -u',
];
for (const c of askShell) expect(`shell ask: ${c}`, shell(c), 'ask');

writeFileSync(path.join(repo, 'config.ts'), `export const token = '${fake.github}';\n`);
sh('git', ['add', 'config.ts']);
expect('shell deny: git commit with a staged token', shell('git commit -m "feat: config"'), 'deny');
expect(
  'shell deny: git commit -am with a staged token',
  shell('git commit -am "feat: config"'),
  'deny',
);
sh('git', ['rm', '-q', '--cached', 'config.ts']);
rmSync(path.join(repo, 'config.ts'));
writeFileSync(path.join(repo, '.env'), 'API_URL=http://localhost\n');
sh('git', ['add', '.env']);
expect('shell deny: git commit of a .env file', shell('git commit -m "chore: env"'), 'deny');
sh('git', ['rm', '-q', '--cached', '.env']);

// --- beforeReadFile ---------------------------------------------------------
const read = (file_path, content = 'hello') =>
  run('guard-read.mjs', { ...base, file_path, content }).json?.permission;
expect(
  'read deny: ~/.npmrc',
  read(path.join(home, '.npmrc'), '@scope:registry=https://example.invalid'),
  'deny',
);
expect('read deny: ~/.ssh private key', read(path.join(home, '.ssh', 'id_ed25519')), 'deny');
expect('read deny: repo .env', read(path.join(repo, '.env'), 'X=1'), 'deny');
expect(
  'read deny: file containing a token',
  read(path.join(repo, 'src', 'config.ts'), `const t = '${fake.github}';`),
  'deny',
);
expect(
  'read deny: npmrc with auth line',
  read(path.join(repo, '.npmrc'), `//npm.pkg.github.com/:_authToken=${fake.github}`),
  'deny',
);
expect(
  'read allow: repo .npmrc registry line',
  read(path.join(repo, '.npmrc'), '@hylandsoftware:registry=https://npm.pkg.github.com'),
  'allow',
);
expect(
  'read allow: npmrc env reference',
  read(path.join(repo, 'ci.npmrc'), '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'),
  'allow',
);
expect(
  'read allow: .env.example',
  read(path.join(repo, '.env.example'), 'API_URL=changeme'),
  'allow',
);
expect(
  'read allow: ordinary source',
  read(path.join(repo, 'src', 'app.ts'), 'export const x = 1;'),
  'allow',
);
expect('read allow: public ssh key', read(path.join(home, '.ssh', 'id_ed25519.pub')), 'allow');
expect(
  'read allow: token-like fixture in node_modules',
  read(path.join(repo, 'node_modules', 'pkg', 'fixture.js'), fake.npm),
  'allow',
);

// --- preToolUse -------------------------------------------------------------
const tool = (tool_name, tool_input) =>
  run('guard-tool.mjs', { ...base, tool_name, tool_input, cwd: repo }).json?.permission;
expect(
  'tool deny: Write with a token',
  tool('Write', { path: path.join(repo, 'a.ts'), contents: `const k = '${fake.npm}';` }),
  'deny',
);
expect(
  'tool deny: StrReplace adding a PAT',
  tool('StrReplace', { path: path.join(repo, 'a.ts'), new_string: fake.githubPat }),
  'deny',
);
expect(
  'tool deny: Delete outside repo',
  tool('Delete', { path: path.join(home, 'notes.txt') }),
  'deny',
);
expect(
  'tool deny: Grep in ~/.npmrc',
  tool('Grep', { pattern: 'authToken', path: '~/.npmrc' }),
  'deny',
);
expect('tool deny: Grep across $HOME', tool('Grep', { pattern: 'token', path: home }), 'deny');
expect(
  'tool allow: Write ordinary file',
  tool('Write', { path: path.join(repo, 'a.ts'), contents: 'export const a = 1;' }),
  'allow',
);
expect(
  'tool allow: Delete inside repo',
  tool('Delete', { path: path.join(repo, 'tmp', 'x.json') }),
  'allow',
);
expect(
  'tool allow: Grep in repo',
  tool('Grep', { pattern: 'signal', path: path.join(repo, 'libs') }),
  'allow',
);

// --- beforeSubmitPrompt -----------------------------------------------------
const prompt = (p) => run('guard-prompt.mjs', { ...base, prompt: p }).json?.continue;
expect('prompt block: contains a PAT', prompt(`use this token ${fake.githubPat} for CI`), false);
expect('prompt allow: ordinary prompt', prompt('Add the allocation screen with tests'), true);

// --- afterFileEdit ----------------------------------------------------------
const loose = 'const   x = {a:1}\n';
writeFileSync(path.join(repo, 'loose.ts'), loose);
const fmt = run('format.mjs', { ...base, file_path: path.join(repo, 'loose.ts') });
expect('format: exits 0 without Prettier', fmt.code, 0);
expect(
  'format: leaves file untouched without Prettier',
  readFileSync(path.join(repo, 'loose.ts'), 'utf8'),
  loose,
);
if (existsSync(path.join(projectRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs'))) {
  const target = path.join(projectRoot, 'tmp', `hook-format-test-${process.pid}.ts`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, loose);
  const target2 = path.join(hooksDir, `format-fixture-${process.pid}.ts`);
  writeFileSync(target2, loose);
  run('format.mjs', { ...base, workspace_roots: [projectRoot], file_path: target2 });
  expect(
    'format: formats a file with workspace Prettier',
    readFileSync(target2, 'utf8'),
    'const x = { a: 1 };\n',
  );
  run('format.mjs', { ...base, workspace_roots: [projectRoot], file_path: target });
  expect('format: skips tmp/', readFileSync(target, 'utf8'), loose);
  rmSync(target, { force: true });
  rmSync(target2, { force: true });
} else {
  results.push({
    ok: true,
    name: 'format: real Prettier run skipped (no node_modules here)',
    detail: '',
  });
}

// --- stop -------------------------------------------------------------------
mkdirSync(path.join(repo, 'apps', 'web', 'src'), { recursive: true });
writeFileSync(path.join(repo, 'apps', 'web', 'src', 'page.ts'), 'export const p = 1;\n');
const stopQuiet = run('stop-summary.mjs', { ...base, status: 'completed', loop_count: 0 });
expect('stop: no follow-up by default', JSON.stringify(stopQuiet.json), '{}');
expect(
  'stop: writes a run summary',
  readdirSync(path.join(repo, 'tmp', 'agent-runs')).length > 0,
  true,
);
const stopNudge = run(
  'stop-summary.mjs',
  { ...base, status: 'completed', loop_count: 0 },
  { BF_STOP_NUDGE: '1' },
);
expect(
  'stop: nudges when enabled and functional checks are missing',
  typeof stopNudge.json?.followup_message,
  'string',
);
const stopLoop = run(
  'stop-summary.mjs',
  { ...base, status: 'completed', loop_count: 1 },
  { BF_STOP_NUDGE: '1' },
);
expect('stop: nudges only once', JSON.stringify(stopLoop.json), '{}');

// --- robustness -------------------------------------------------------------
const broken = run('guard-shell.mjs', '{not json');
expect('robust: invalid input fails open (exit 1)', broken.code, 1);
expect('robust: invalid input prints nothing', broken.json, null);
expect(
  'robust: empty command allowed',
  run('guard-shell.mjs', { ...base, command: '' }).json?.permission,
  'allow',
);

rmSync(sandbox, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\nhook tests: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
