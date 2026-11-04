#!/usr/bin/env node
// Structural checks for the Cursor harness: JSON configs, rule/skill/agent frontmatter, links.
// Run through scripts/validate-harness.sh, which adds shellcheck, hook tests and a secret scan.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSecrets } from './secret-patterns.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const rel = (p) => relative(root, p);

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}

function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    data[kv[1]] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return { data, body: text.slice(m[0].length), lines: text.split('\n').length };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (err) {
    errors.push(`${file}: ${err.code === 'ENOENT' ? 'missing' : `invalid JSON (${err.message})`}`);
    return null;
  }
}

function checkLinks(file, body) {
  for (const [, target] of body.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(resolve(dirname(file), target))) errors.push(`${rel(file)}: broken link ${target}`);
  }
}

// JSON configs
const hooks = readJson('.cursor/hooks.json');
if (hooks) {
  if (hooks.version !== 1) errors.push('.cursor/hooks.json: version must be 1');
  for (const [event, defs] of Object.entries(hooks.hooks ?? {})) {
    for (const def of defs) {
      for (const token of String(def.command).split(/\s+/)) {
        if (/^\.cursor\/hooks\/.+\.(sh|mjs)$/.test(token) && !existsSync(join(root, token))) {
          errors.push(`.cursor/hooks.json (${event}): missing ${token}`);
        }
      }
    }
  }
}
const mcp = readJson('.cursor/mcp.json');
if (mcp) {
  for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
    const flat = JSON.stringify(server);
    if (/@latest\b/.test(flat)) warnings.push(`.cursor/mcp.json: ${name} uses @latest; pin a version`);
    for (const value of Object.values(server.env ?? {})) {
      if (!/^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) {
        errors.push(`.cursor/mcp.json: ${name} env values must be \${env:NAME} references`);
      }
    }
  }
}
const worktrees = readJson('.cursor/worktrees.json');
for (const key of ['setup-worktree-unix', 'setup-worktree', 'setup-worktree-windows']) {
  const v = worktrees?.[key];
  if (typeof v === 'string' && !existsSync(join(root, '.cursor', v))) errors.push(`.cursor/worktrees.json: ${key} script ${v} missing`);
}
const env = readJson('.cursor/environment.json');
if (env) {
  // Keys documented at cursor.com/docs/cloud-agent/setup.
  const allowed = new Set(['install', 'start', 'terminals', 'build', 'snapshot']);
  for (const k of Object.keys(env)) if (!allowed.has(k)) errors.push(`.cursor/environment.json: undocumented key ${k}`);
}
for (const file of ['.cursor/environment.json', '.cursor/mcp.json', '.cursor/hooks.json', '.cursor/worktrees.json']) {
  const p = join(root, file);
  if (existsSync(p) && findSecrets(readFileSync(p, 'utf8')).length) errors.push(`${file}: contains a credential`);
}

// Rules
const rules = walk(join(root, '.cursor/rules'), (n) => n.endsWith('.mdc'));
let alwaysOn = 0;
for (const file of rules) {
  const fm = frontmatter(file);
  if (!fm) { errors.push(`${rel(file)}: missing frontmatter`); continue; }
  if (typeof fm.data.alwaysApply !== 'boolean') errors.push(`${rel(file)}: alwaysApply must be true or false`);
  if (fm.data.alwaysApply) alwaysOn++;
  if (!fm.data.alwaysApply && !fm.data.description && !fm.data.globs) warnings.push(`${rel(file)}: manual-only rule (no description or globs)`);
  if (fm.lines > 90) warnings.push(`${rel(file)}: ${fm.lines} lines; keep rules short`);
  checkLinks(file, fm.body);
}
if (alwaysOn > 1) warnings.push(`${alwaysOn} always-on rules; only 00-core.mdc should be`);

// Skills
const skillNames = new Map();
for (const file of walk(join(root, '.cursor/skills'), (n) => n === 'SKILL.md')) {
  const fm = frontmatter(file);
  const folder = basename(dirname(file));
  if (!fm) { errors.push(`${rel(file)}: missing frontmatter`); continue; }
  const { name, description } = fm.data;
  if (name !== folder) errors.push(`${rel(file)}: name "${name}" must equal folder "${folder}"`);
  if (!/^[a-z0-9-]{1,64}$/.test(String(name))) errors.push(`${rel(file)}: invalid name "${name}"`);
  if (!description || String(description).length > 1024) errors.push(`${rel(file)}: description missing or over 1024 chars`);
  if (skillNames.has(name)) errors.push(`${rel(file)}: duplicate skill name ${name} (also ${skillNames.get(name)})`);
  skillNames.set(name, rel(file));
  if (fm.lines > 500) errors.push(`${rel(file)}: over 500 lines`);
  if (rel(file).includes('/commands/') && fm.data['disable-model-invocation'] !== true) {
    errors.push(`${rel(file)}: command skills need disable-model-invocation: true`);
  }
  checkLinks(file, fm.body);
}

// Subagents
for (const file of walk(join(root, '.cursor/agents'), (n) => n.endsWith('.md'))) {
  const fm = frontmatter(file);
  if (!fm) { errors.push(`${rel(file)}: missing frontmatter`); continue; }
  if (fm.data.name !== basename(file, '.md')) errors.push(`${rel(file)}: name must equal file name`);
  if (!fm.data.description) errors.push(`${rel(file)}: description missing`);
  if (skillNames.has(fm.data.name)) errors.push(`${rel(file)}: subagent name collides with skill ${fm.data.name}`);
}

// Required skills and subagents
const REQUIRED_SKILLS = [
  'functional-check', 'visual-qa-loop', 'ux-verify', 'run-gates', 'add-feature-screen', 'domain-change', 'ledger-change',
  'api-endpoint', 'db-migration', 'integration-adapter', 'ai-feature-guardrails', 'parallel-worktree-build',
  'phase-gate-review', 'pr-workflow', 'security-review-handoff',
  'gate', 'new-screen', 'verify-ui', 'visual-qa', 'phase-review', 'parallel-build',
];
for (const s of REQUIRED_SKILLS) if (!skillNames.has(s)) errors.push(`missing skill ${s}`);
for (const a of ['functional-tester', 'domain-invariant-reviewer', 'ux-reviewer', 'integrator']) {
  if (!existsSync(join(root, '.cursor/agents', `${a}.md`))) errors.push(`missing subagent ${a}`);
}

// Decisions that must not regress: no prototype or GitHub Pages content, no app translations, no unit-test
// requirement, accessibility checks off. Matches are reported with file and line.
const BANNED = [
  [/\bprototype\b|mock-store|in-browser mock/i, 'prototype or mock-store content'],
  [/gh-pages|github\.io|deploy-pages|pages\.yml/i, 'GitHub Pages content'],
  [/\bi18n\b|translation keys? (?:for|in) every|\| translate\b|ngx-translate keys/i, 'app translation requirement'],
  [/\bvitest\b|@analogjs|coverage (?:gate|threshold)|testing-unit\.mdc|test-author/i, 'unit-test requirement'],
  [/@axe-core|\baxe (?:scan|results|clean)|testing-e2e-a11y/i, 'accessibility check (a11y is off)'],
  [/\bRTL\b/, 'RTL capture'],
];
const scanned = [
  'AGENTS.md', '.cursor/BUGBOT.md', '.github/pull_request_template.md', '.github/workflows/ci.yml', 'evidence/README.md',
  ...walk(join(root, '.cursor'), (n) => /\.(md|mdc|json|mjs|sh)$/.test(n)).map((p) => rel(p)),
  ...walk(join(root, 'docs'), (n) => /\.(md|json|ts)$/.test(n)).map((p) => rel(p)),
  ...walk(join(root, 'scripts'), (n) => /\.(mjs|sh|html)$/.test(n)).map((p) => rel(p)),
].filter((f) => !['scripts/validate-harness.mjs', '.cursor/hooks/test-hooks.mjs'].includes(f));
for (const file of [...new Set(scanned)]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    for (const [re, what] of BANNED) if (re.test(line)) errors.push(`${file}:${i + 1}: ${what}: ${line.trim().slice(0, 80)}`);
  });
}

// One pinned Playwright version everywhere, so local and CI renders match.
const pins = new Map();
const pin = (file, re) => {
  const p = join(root, file);
  if (!existsSync(p)) return;
  const m = re.exec(readFileSync(p, 'utf8'));
  if (m) pins.set(file, m[1]);
  else errors.push(`${file}: Playwright version pin not found`);
};
pin('scripts/visual/pw-docker.sh', /PW_VERSION=(\d+\.\d+\.\d+)/);
pin('scripts/visual/setup-tools.sh', /PW_VERSION=(\d+\.\d+\.\d+)/);
pin('.github/workflows/ci.yml', /playwright:v(\d+\.\d+\.\d+)-noble/);
pin('.cursor/rules/testing-visual.mdc', /playwright:v(\d+\.\d+\.\d+)-noble/);
pin('docs/ai-harness/templates/package-json-additions.json', /"@playwright\/test": "(\d+\.\d+\.\d+)"/);
if (existsSync(join(root, 'package.json'))) pin('package.json', /"@playwright\/test": "\^?~?(\d+\.\d+\.\d+)"/);
if (new Set(pins.values()).size > 1) errors.push(`Playwright versions differ: ${[...pins].map(([f, v]) => `${f}=${v}`).join(', ')}`);

// Bugbot and docs links
for (const file of ['.cursor/BUGBOT.md', 'docs/ai-harness/README.md', 'AGENTS.md', 'design/stitch/README.md', 'docs/testing/invariant-scenarios.md', 'evidence/README.md']) {
  const p = join(root, file);
  if (existsSync(p)) checkLinks(p, readFileSync(p, 'utf8'));
  else errors.push(`${file}: missing`);
}

// Executable bits for directly invoked scripts (scripts/lib/ is sourced, not executed)
const topLevelScripts = existsSync(join(root, 'scripts'))
  ? readdirSync(join(root, 'scripts')).filter((n) => n.endsWith('.sh')).map((n) => join(root, 'scripts', n))
  : [];
for (const file of [...topLevelScripts, ...walk(join(root, '.githooks'), () => true)]) {
  if (!(statSync(file).mode & 0o111)) warnings.push(`${rel(file)}: not executable (chmod +x)`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`validate-harness: ${rules.length} rules, ${skillNames.size} skills, ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
