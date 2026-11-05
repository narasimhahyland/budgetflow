// beforeShellExecution: blocks credential reads, secret printing, force pushes to main,
// deletes outside the repo and its worktrees, and commits that contain secrets.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_ENV_NAME } from '../../scripts/secret-patterns.mjs';
import {
  HOME,
  commandOf,
  isInside,
  isTemp,
  repoWorktrees,
  resolvePath,
  runHook,
  sensitivePathReason,
  splitSegments,
  workspaceRoots,
  worktreeRootOf,
} from './lib.mjs';

const SCAN = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
const PROTECTED = /^(refs\/heads\/)?(main|master)$/;

function gitBranch(cwd) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    timeout: 3000,
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Splits `git [-C dir] [-c k=v] <sub> args` into { sub, args, cwd }. */
function parseGit(args, cwd) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C') {
      cwd = resolvePath(args[i + 1], cwd) ?? cwd;
      i += 2;
    } else if (args[i] === '-c') i += 2;
    else i++;
  }
  return { sub: args[i], args: args.slice(i + 1), cwd };
}

function shortFlags(args, valueFlags) {
  const flags = new Set();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      flags.add(a.split('=')[0]);
      continue;
    }
    if (/^-[A-Za-z]+$/.test(a)) {
      for (const ch of a.slice(1)) flags.add(`-${ch}`);
      if (valueFlags.includes(a.at(-1))) i++;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

function checkPush(args, cwd, verdict) {
  const { flags, positional } = shortFlags(args, ['o']);
  const force =
    flags.has('--force') ||
    flags.has('-f') ||
    flags.has('--force-with-lease') ||
    flags.has('--force-if-includes');
  if (flags.has('--mirror')) return verdict.deny('git push --mirror rewrites every remote branch');
  const refspecs = positional.slice(1);
  const current = refspecs.some((r) => /^\+?HEAD$/.test(r)) ? gitBranch(cwd) : null;
  const dsts = refspecs
    .map((r) => r.replace(/^\+/, '').split(':').pop())
    .map((d) => (d === 'HEAD' ? (current ?? d) : d));
  const deleting =
    flags.has('--delete') || flags.has('-d') || refspecs.some((r) => r.startsWith(':'));
  if (deleting && dsts.some((d) => PROTECTED.test(d)))
    return verdict.deny('deleting main/master on the remote');
  const plusForce = refspecs.some((r, i) => r.startsWith('+') && PROTECTED.test(dsts[i]));
  if (!force && !plusForce) return;
  if (plusForce || dsts.some((d) => PROTECTED.test(d)) || flags.has('--all')) {
    return verdict.deny('force push to main/master');
  }
  if (refspecs.length === 0) {
    const branch = gitBranch(cwd);
    if (branch === null)
      return verdict.ask('force push with no refspec and the current branch is unknown');
    if (PROTECTED.test(branch)) return verdict.deny('force push while on main/master');
  }
}

function checkCommit(args, cwd, verdict) {
  const { flags } = shortFlags(args, ['m', 'F', 'C', 'c', 't']);
  if (flags.has('--no-verify') || flags.has('-n')) {
    verdict.ask('git commit --no-verify skips the secret-scan pre-commit hook');
  }
  if (!existsSync(SCAN)) return;
  const mode = flags.has('-a') || flags.has('--all') ? '--worktree' : '--staged';
  const r = spawnSync(process.execPath, [SCAN, mode, '--quiet'], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (r.status === 1) {
    const lines = r.stdout.trim().split('\n').slice(0, 8).join('; ');
    verdict.deny(`secret scan found problems in the files being committed: ${lines}`);
  }
}

function checkRm(name, args, cwd, roots, verdict) {
  let targets;
  if (name === 'find') {
    if (
      !args.includes('-delete') &&
      !args.some((a, i) => a === '-exec' && /(^|\/)rm$/.test(args[i + 1] ?? ''))
    )
      return;
    targets = args.filter((a) => !a.startsWith('-') && !a.startsWith('(')).slice(0, 1);
    if (!targets.length) targets = ['.'];
  } else {
    const { positional } = shortFlags(args, []);
    targets = positional;
  }
  for (const raw of targets) {
    const abs = resolvePath(raw, cwd);
    if (abs === null) {
      verdict.ask(`${name} target "${raw}" uses a variable the guard cannot resolve`);
      continue;
    }
    if (abs === '/' || abs === HOME || path.dirname(abs) === '/')
      return verdict.deny(`${name} on ${abs}`);
    if (roots.some((r) => abs === r))
      return verdict.deny(`${name} on the whole workspace (${abs})`);
    if (isInside(abs, roots) || isTemp(abs)) continue;
    const worktrees = repoWorktrees(roots);
    const owner = worktreeRootOf(abs, worktrees);
    if (owner && (isInside(cwd, roots) || worktreeRootOf(cwd, worktrees))) {
      if (abs === owner)
        return verdict.deny(`${name} on a whole worktree (${abs}); use scripts/worktree.sh remove`);
      continue;
    }
    return verdict.deny(
      `${name} outside the repository (${abs}); use scripts/worktree.sh remove for worktrees`,
    );
  }
}

function inspect(command, cwd, roots, verdict, depth = 0) {
  if (depth > 2) return;
  const raw = command;
  const adjacentHomeNpmrc =
    /(~|\$\{?HOME\}?["']?|\/Users\/[^\s'"/]+|\/home\/[^\s'"/]+|\/root)\/\.npmrc\b/;
  const programmaticHome = /(homedir\s*\(|process\.env\.HOME|expanduser|Path\.home|userconfig)/;
  if (adjacentHomeNpmrc.test(raw) || (/\.npmrc\b/.test(raw) && programmaticHome.test(raw))) {
    verdict.deny('reading or copying the user npm config (~/.npmrc) exposes the registry token');
  }

  for (const tokens of splitSegments(command)) {
    const { name, args } = commandOf(tokens);
    if (!name) continue;

    const line = [name, ...args].join(' ');
    if (/\bdrizzle-kit\s+push\b/.test(line)) {
      verdict.deny(
        'drizzle-kit push changes the schema without a reviewed migration; use drizzle-kit generate and the migrate target',
      );
    }
    if (/\bdrizzle-kit\s+drop\b/.test(line))
      verdict.ask('drizzle-kit drop deletes migration files');
    if (/^docker(-compose)?\b/.test(line)) {
      const sub = args.filter((a) => !a.startsWith('-'));
      const composeDown =
        (name === 'docker-compose' || sub[0] === 'compose') &&
        args.includes('down') &&
        args.some((a) => a === '-v' || a === '--volumes');
      if (composeDown)
        verdict.ask(
          'docker compose down -v deletes database volumes; scripts/stack.sh reset limits this to this checkout',
        );
      if (sub[0] === 'volume' && ['rm', 'prune'].includes(sub[1]))
        verdict.ask(`docker volume ${sub[1]} deletes data volumes`);
      if (sub[0] === 'system' && sub[1] === 'prune')
        verdict.ask('docker system prune deletes containers, images and possibly volumes');
    }

    for (const t of [name, ...args]) {
      const abs = resolvePath(t, cwd);
      const reason =
        abs && (t.includes('/') || t.startsWith('.')) ? sensitivePathReason(abs, roots) : null;
      if (reason) verdict.deny(`command touches ${t}: ${reason}`);
    }
    if (/\.npmrc$/.test(args.join(' ')) && path.resolve(cwd) === HOME)
      verdict.deny('reading ~/.npmrc from the home directory');

    const pwArgs =
      name === 'playwright'
        ? args
        : ['npx', 'pnpm', 'yarn'].includes(name) && args[0] === 'playwright'
          ? args.slice(1)
          : null;
    if (
      pwArgs?.[0] === 'test' &&
      pwArgs.some((a) => a === '-u' || a.startsWith('--update-snapshots')) &&
      process.env.PW_DOCKER !== '1'
    ) {
      verdict.ask(
        'visual baselines are updated only in the pinned Playwright image: use npm run e2e:update-snapshots and give the reason in the PR',
      );
    }

    switch (name) {
      case 'cd':
      case 'pushd':
        cwd = resolvePath(args[0] ?? HOME, cwd) ?? cwd;
        break;
      case 'sh':
      case 'bash':
      case 'zsh': {
        const c = args.indexOf('-c');
        if (c >= 0 && args[c + 1]) inspect(args[c + 1], cwd, roots, verdict, depth + 1);
        break;
      }
      case 'echo':
      case 'printf':
      case 'print': {
        const leaked = args
          .join(' ')
          .match(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)
          ?.map((v) => v.replace(/^\$\{?/, ''))
          .filter((v) => SECRET_ENV_NAME.test(v));
        if (leaked?.length)
          verdict.deny(`printing secret environment variable ${leaked.join(', ')}`);
        break;
      }
      case 'printenv':
        if (args.length === 0)
          verdict.ask('printenv dumps every environment variable, including secrets');
        else if (args.some((a) => SECRET_ENV_NAME.test(a)))
          verdict.deny(`printing secret environment variable ${args.join(' ')}`);
        break;
      case 'env':
        if (args.length === 0)
          verdict.ask('env dumps every environment variable, including secrets');
        break;
      case 'export':
      case 'declare':
      case 'typeset':
        if (args.length === 1 && ['-p', '-x'].includes(args[0]))
          verdict.ask(`${name} ${args[0]} dumps environment variables`);
        break;
      case 'set':
        if (args.length === 0) verdict.ask('set dumps all shell variables');
        break;
      case 'npm':
        if (
          args[0] === 'config' &&
          ['get', 'list', 'ls'].includes(args[1]) &&
          args.some((a) => /_auth/i.test(a))
        ) {
          verdict.deny('reading npm auth config');
        }
        break;
      case 'gh':
        if (args[0] === 'auth' && args[1] === 'token')
          verdict.deny('gh auth token prints the GitHub token');
        if (
          args[0] === 'auth' &&
          args[1] === 'status' &&
          args.some((a) => a === '-t' || a === '--show-token')
        )
          verdict.deny('gh auth status --show-token prints the token');
        if (args[0] === 'secret' && args[1] === 'set')
          verdict.ask('setting a repository secret; the user should do this themselves');
        break;
      case 'security':
        if (
          /^find-(generic|internet)-password$/.test(args[0] ?? '') &&
          args.some((a) => /^-[a-z]*[wg]/.test(a))
        )
          verdict.deny('reading a keychain password');
        break;
      case 'cat':
      case 'less':
      case 'head':
      case 'tail':
        if (args.some((a) => /^\/proc\/[^/]+\/environ$/.test(a)))
          verdict.deny('reading a process environment');
        break;
      case 'git': {
        const g = parseGit(args, cwd);
        if (g.sub === 'push') checkPush(g.args, g.cwd, verdict);
        else if (g.sub === 'commit') checkCommit(g.args, g.cwd, verdict);
        else if (g.sub === 'credential' && ['fill', 'get'].includes(g.args[0]))
          verdict.deny('git credential fill prints stored credentials');
        else if (g.sub === 'reset' && g.args.includes('--hard'))
          verdict.ask('git reset --hard discards uncommitted work');
        else if (
          g.sub === 'clean' &&
          g.args.some((a) => /^-[a-z]*f/.test(a)) &&
          g.args.some((a) => /^-[a-z]*[dx]/.test(a))
        )
          verdict.ask('git clean -fd/-fx deletes untracked files');
        else if (
          g.sub === 'branch' &&
          g.args.some((a) => a === '-D' || a === '--delete') &&
          g.args.some((a) => PROTECTED.test(a))
        )
          verdict.deny('deleting the main/master branch');
        break;
      }
      case 'rm':
      case 'find':
        checkRm(name, args, cwd, roots, verdict);
        break;
      default:
        break;
    }
  }
}

runHook((input) => {
  const command = String(input.command ?? '');
  const roots = workspaceRoots(input);
  const cwd = input.cwd || roots[0] || process.cwd();
  const reasons = { deny: [], ask: [] };
  const verdict = {
    deny: (r) => void reasons.deny.push(r),
    ask: (r) => void reasons.ask.push(r),
  };
  inspect(command, cwd, roots, verdict);

  if (reasons.deny.length) {
    const why = [...new Set(reasons.deny)].join('; ');
    return {
      permission: 'deny',
      user_message: `BudgetFlow guard blocked this command: ${why}.`,
      agent_message: `Blocked by a project hook: ${why}. Do not retry with a reworded command. If the action is truly needed, explain why and ask the user to run it themselves.`,
    };
  }
  if (reasons.ask.length) {
    const why = [...new Set(reasons.ask)].join('; ');
    return {
      permission: 'ask',
      user_message: `BudgetFlow guard: ${why}. Allow it?`,
      agent_message: `A project hook asked the user to confirm: ${why}.`,
    };
  }
  return { permission: 'allow' };
});
