// Shared helpers for BudgetFlow Cursor hooks. Dependency-free; Node 20+.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  FORBIDDEN_FILES,
  SENSITIVE_HOME_DIRS,
  SENSITIVE_HOME_FILES,
} from '../../scripts/secret-patterns.mjs';

export const HOME = process.env.HOME || homedir();

/** Runs a hook. Internal errors exit 1 so Cursor fails open instead of blocking on a broken hook. */
export function runHook(handler) {
  try {
    const raw = readFileSync(0, 'utf8');
    const input = raw.trim() ? JSON.parse(raw) : {};
    const output = handler(input);
    if (output !== undefined) process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`budgetflow hook error: ${err?.stack ?? err}\n`);
    process.exit(1);
  }
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function workspaceRoots(input) {
  const roots = [...(input.workspace_roots ?? []), process.env.CURSOR_PROJECT_DIR].filter(Boolean);
  return [...new Set(roots.flatMap((r) => [path.resolve(r), real(r)]))];
}

export function isInside(p, dirs) {
  const abs = path.resolve(p);
  return dirs.some((d) => abs === d || abs.startsWith(d.endsWith(path.sep) ? d : d + path.sep));
}

const TEMP_DIRS = [
  ...new Set(
    ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir(), process.env.TMPDIR]
      .filter(Boolean)
      .flatMap((d) => [path.resolve(d), real(d)]),
  ),
];

export function isTemp(p) {
  const abs = path.resolve(p);
  return TEMP_DIRS.some((d) => abs !== d && abs.startsWith(d + path.sep));
}

/** Expands ~ and $HOME and resolves against cwd. Returns null when the path still has unexpanded variables. */
export function resolvePath(raw, cwd) {
  let p = String(raw);
  if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
  p = p.replace(/^\$\{?HOME\}?(?=\/|$)/, HOME);
  if (/[$`]/.test(p)) return null;
  return path.resolve(cwd || process.cwd(), p);
}

/** Returns a reason string when the absolute path is a credential store, else null. */
export function sensitivePathReason(abs, roots = []) {
  if (!abs) return null;
  for (const f of SENSITIVE_HOME_FILES) {
    if (abs === path.join(HOME, f)) return `~/${f} holds credentials`;
  }
  for (const d of SENSITIVE_HOME_DIRS) {
    const dir = path.join(HOME, d);
    if (abs.startsWith(dir + path.sep)) {
      const base = path.basename(abs);
      if (!/\.pub$|^known_hosts|^config$|^authorized_keys$/.test(base))
        return `~/${d} private keys`;
    }
  }
  const base = path.basename(abs);
  if ((base === '.npmrc' || base === 'npmrc') && !isInside(abs, roots)) {
    return 'npm config outside the repository can hold registry tokens';
  }
  return null;
}

/** Reason when a file name is one that must never be read or committed (env files, keys). */
export function forbiddenFileReason(abs) {
  const posix = abs.split(path.sep).join('/');
  for (const rule of FORBIDDEN_FILES) {
    if (rule.id === 'har-capture' || rule.id === 'playwright-trace') continue;
    if (rule.re.test(posix) && !(rule.allow && rule.allow.test(posix)))
      return `${rule.id} files can hold secrets`;
  }
  return null;
}

/**
 * Splits a shell command into segments of tokens, honoring quotes and escapes.
 * Separators: ; & | newline ( ) and backticks, so $(...), subshells and pipelines become separate segments.
 */
export function splitSegments(command) {
  const segments = [];
  let tokens = [];
  let cur = '';
  let started = false;
  let quote = null;
  const pushToken = () => {
    if (started) tokens.push(cur);
    cur = '';
    started = false;
  };
  const pushSegment = () => {
    pushToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === '\\' && i + 1 < command.length) {
      cur += command[++i];
      started = true;
    } else if (c === ' ' || c === '\t') {
      pushToken();
    } else if (';&|\n()`'.includes(c)) {
      pushSegment();
    } else {
      cur += c;
      started = true;
    }
  }
  pushSegment();
  return segments;
}

/** Strips leading env assignments and wrappers (sudo, command, env VAR=x, nice, time) from a segment. */
export function commandOf(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) i++;
    else if (['sudo', 'command', 'nice', 'time', 'nohup', 'exec'].includes(t)) i++;
    else if (
      t === 'env' &&
      i + 1 < tokens.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=|^-/.test(tokens[i + 1])
    )
      i++;
    else break;
  }
  const name = tokens[i] ? path.basename(tokens[i]) : '';
  return { name, args: tokens.slice(i + 1) };
}
