#!/usr/bin/env node
// Secret and public-repo hygiene scanner. Dependency-free.
// Usage:
//   node scripts/secret-scan.mjs [--staged]          staged content (default; used by pre-commit)
//   node scripts/secret-scan.mjs --worktree          tracked changes vs HEAD, staged and unstaged
//   node scripts/secret-scan.mjs --all               every tracked and untracked-but-not-ignored file
//   node scripts/secret-scan.mjs --dir <path>        every file under a directory (e.g. a build output)
//   node scripts/secret-scan.mjs --files <f>...      explicit files
// Flags: --quiet (findings only), --no-internal (skip internal-URL checks).
// Exit codes: 0 clean, 1 findings, 2 usage or git error.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ALLOW_MARKER,
  FORBIDDEN_FILES,
  INTERNAL_PATTERNS,
  SECRET_PATTERNS,
  mask,
} from './secret-patterns.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.nx', '.angular', 'coverage']);

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const quiet = has('--quiet');
const patterns = has('--no-internal') ? SECRET_PATTERNS : [...SECRET_PATTERNS, ...INTERNAL_PATTERNS];

function git(argv) {
  return execFileSync('git', argv, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
}

function splitZ(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Returns [{ path, read: () => Buffer }]. */
function collectTargets() {
  if (has('--files')) {
    return args
      .slice(args.indexOf('--files') + 1)
      .filter((a) => !a.startsWith('--'))
      .map((p) => ({ path: p, read: () => readFileSync(p) }));
  }
  if (has('--dir')) {
    const dir = args[args.indexOf('--dir') + 1];
    if (!dir) throw new Error('--dir needs a path');
    return walk(dir).map((p) => ({ path: relative(process.cwd(), p), read: () => readFileSync(p) }));
  }
  process.chdir(git(['rev-parse', '--show-toplevel']).toString().trim());
  if (has('--all')) {
    const tracked = splitZ(git(['ls-files', '-z']));
    const untracked = splitZ(git(['ls-files', '-z', '--others', '--exclude-standard']));
    return [...new Set([...tracked, ...untracked])].map((p) => ({ path: p, read: () => readFileSync(p) }));
  }
  if (has('--worktree')) {
    let names;
    try {
      names = splitZ(git(['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD']));
    } catch {
      names = [
        ...splitZ(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])),
        ...splitZ(git(['diff', '--name-only', '-z', '--diff-filter=ACMR'])),
      ];
    }
    return [...new Set(names)].map((p) => ({ path: p, read: () => readFileSync(p) }));
  }
  const staged = splitZ(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']));
  return staged.map((p) => ({ path: p, read: () => git(['show', `:${p}`]) }));
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

function scan(targets) {
  const findings = [];
  for (const { path, read } of targets) {
    for (const rule of FORBIDDEN_FILES) {
      if (rule.re.test(path) && !(rule.allow && rule.allow.test(path))) {
        findings.push({ path, line: 0, id: rule.id, preview: 'file must not be committed' });
      }
    }
    let buf;
    try {
      if (statSync(path, { throwIfNoEntry: false })?.size > MAX_BYTES) continue;
      buf = read();
    } catch {
      continue;
    }
    if (buf.length > MAX_BYTES || isBinary(buf)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (text.includes(ALLOW_MARKER)) return;
      for (const { id, re } of patterns) {
        const m = re.exec(text);
        if (m) findings.push({ path, line: i + 1, id, preview: mask(m[0]) });
      }
    });
  }
  return findings;
}

try {
  const targets = collectTargets();
  const findings = scan(targets);
  if (findings.length === 0) {
    if (!quiet) console.log(`secret-scan: clean (${targets.length} files)`);
    process.exit(0);
  }
  for (const f of findings) {
    console.log(`${f.path}${f.line ? `:${f.line}` : ''}  ${f.id}  ${f.preview}`);
  }
  console.log(
    `secret-scan: ${findings.length} finding(s). Remove the secret or internal reference; if a real secret was ever committed or pushed, rotate it.`,
  );
  process.exit(1);
} catch (err) {
  console.error(`secret-scan: ${err.message}`);
  process.exit(2);
}
