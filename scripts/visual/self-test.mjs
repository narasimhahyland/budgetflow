#!/usr/bin/env node
// Self-test for the visual tooling without the real app: serves static fixtures and checks that capture.mjs
// detects every class of problem (and causes none itself), that compare.mjs and design-parity.mjs produce
// parity output, and that stitch-save.mjs stores designs under the naming convention.
//
// Usage: node scripts/visual/self-test.mjs [--if-available] [--keep]
//   --if-available  skip (exit 0) when Playwright or Chromium is missing, unless VISUAL_SELFTEST=required
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolMissing, ensureDir, launchChromium, parseArgs } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), ['if-available', 'keep']);
const required = process.env.VISUAL_SELFTEST === 'required';

try {
  const browser = await launchChromium();
  await browser.close();
} catch (err) {
  if (err instanceof ToolMissing && args['if-available'] && !required) {
    console.log(`visual self-test: skipped (${err.message})`);
    process.exit(0);
  }
  console.error(`visual self-test: ${err.message}`);
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${String(detail).slice(0, 400)}`}`,
  );
}

const work = mkdtempSync(path.join(tmpdir(), 'bf-visual-selftest-'));
const run = (script, scriptArgs, input) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script), ...scriptArgs], {
      cwd: work,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '');
  if (name === 'favicon.ico') return res.writeHead(204).end();
  const file = path.join(here, 'fixtures', path.basename(name));
  if (!/\.html$/.test(name) || !existsSync(file)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  writeFileSync(
    path.join(work, 'screens.json'),
    JSON.stringify({
      baseURL: base,
      screens: [
        {
          id: '001-good',
          path: '/good.html',
          states: [{ state: 'default', waitFor: 'role=heading[name="Budget hierarchy"]' }],
        },
        { id: '002-bad', path: '/bad.html', states: [{ state: 'default', waitFor: 'h1' }] },
      ],
    }),
  );

  // capture
  const cap = await run('capture.mjs', [
    '--screens',
    'screens.json',
    '--out',
    'capture',
    '--viewports',
    'desktop,mobile',
    '--themes',
    'light,dark',
    '--quiet',
  ]);
  check(
    'capture exits 1 when blocking findings exist',
    cap.status === 1,
    `exit ${cap.status}: ${cap.stderr}`,
  );
  const report = json(path.join(work, 'capture', 'report.json'));
  check(
    'capture writes report.json and report.md',
    Boolean(report) && existsSync(path.join(work, 'capture', 'report.md')),
  );
  const results = report?.results ?? [];
  check(
    'capture covers 2 screens x 2 viewports x 2 themes',
    results.length === 8,
    `${results.length} results`,
  );
  check(
    'every capture has a screenshot',
    results.length > 0 && results.every((r) => existsSync(path.resolve(work, r.file))),
  );
  const good = results.filter((r) => r.id === '001-good');
  const bad = results.filter((r) => r.id === '002-bad');
  const blocking = (r) => r.findings.filter((f) => f.severity === 'blocking');
  check(
    'clean fixture has no blocking findings',
    good.length === 4 && good.every((r) => blocking(r).length === 0),
    JSON.stringify(good.flatMap(blocking)),
  );
  check(
    'capture itself causes no layout shift (theme switch)',
    good.every((r) => !r.findings.some((f) => f.type === 'layout-shift')),
    JSON.stringify(good.flatMap((r) => r.findings)),
  );
  const has = (type) =>
    bad.length === 4 && bad.every((r) => r.findings.some((f) => f.type === type));
  for (const type of ['overflow', 'interpolation', 'console-error', 'request-failed']) {
    check(
      `detects ${type} on every broken capture`,
      has(type),
      JSON.stringify(bad.map((r) => r.findings.map((f) => f.type))),
    );
  }
  // Mobile emulation zooms out to fit the fixture's 2400px overflow, which shrinks its shift score; check desktop.
  const desktopBad = bad.filter((r) => r.viewport === 'desktop');
  check(
    'detects layout-shift as blocking on broken desktop captures',
    desktopBad.length === 2 &&
      desktopBad.every((r) =>
        r.findings.some((f) => f.type === 'layout-shift' && f.severity === 'blocking'),
      ),
  );

  // Shell-style pages: the document never scrolls, <main> does (as in the app shell).
  writeFileSync(
    path.join(work, 'shell-screens.json'),
    JSON.stringify({
      baseURL: base,
      screens: [
        {
          id: '003-shell',
          path: '/shell-good.html',
          states: [
            { state: 'default', waitFor: 'h1' },
            { state: 'typed', waitFor: 'h1', actions: [{ fill: ['#search', 'x'] }] },
          ],
        },
        {
          id: '004-clipped',
          path: '/shell-bad.html',
          states: [{ state: 'default', waitFor: 'h1' }],
        },
      ],
    }),
  );
  await run('capture.mjs', [
    '--screens',
    'shell-screens.json',
    '--out',
    'capture-shell',
    '--viewports',
    'desktop',
    '--themes',
    'light',
    '--quiet',
  ]);
  const shell = json(path.join(work, 'capture-shell', 'report.json'))?.results ?? [];
  const shellPage = shell.filter((r) => r.id === '003-shell');
  const pngHeight = (f) => (existsSync(f) ? readFileSync(f).readUInt32BE(20) : 0);
  const fullHeight = shellPage.find((r) => r.state === 'default');
  const height = fullHeight ? pngHeight(path.resolve(work, fullHeight.file)) : 0;
  check(
    "captures what the page's inner scroller hides below the fold (no blank tail)",
    height > 1800 && height < 2600,
    `screenshot height ${height}px`,
  );
  check(
    'a table scrolling in its own wrapper, an off-canvas drawer and a shift caused by typing are not findings',
    shellPage.length === 2 && shellPage.every((r) => r.findings.length === 0),
    JSON.stringify(shellPage.flatMap((r) => r.findings)),
  );
  const clipped = shell.find((r) => r.id === '004-clipped');
  check(
    'detects a table clipped by its card inside the inner scroller',
    Boolean(
      clipped?.findings.some(
        (f) => f.type === 'overflow' && JSON.stringify(f.detail ?? '').includes('clips'),
      ),
    ),
    JSON.stringify(clipped?.findings ?? []),
  );

  // light only by default (dark theme deferred); the run above proves dark still works when enabled
  const light = await run('capture.mjs', [
    '--screens',
    'screens.json',
    '--out',
    'capture-default',
    '--only',
    '001-good',
    '--viewports',
    'desktop',
    '--quiet',
  ]);
  const lightResults = json(path.join(work, 'capture-default', 'report.json'))?.results ?? [];
  check(
    'capture defaults to the light theme only',
    light.status === 0 && lightResults.length === 1 && lightResults[0].theme === 'light',
    `exit ${light.status}: ${JSON.stringify(lightResults.map((r) => r.theme))}`,
  );

  // compare
  const shot = (id, viewport, theme) =>
    path.join(work, 'capture', 'screens', `${id}--default--${viewport}--${theme}.png`);
  const same = await run('compare.mjs', [
    '--expected',
    shot('001-good', 'desktop', 'light'),
    '--actual',
    shot('001-good', 'desktop', 'light'),
    '--out',
    'cmp',
    '--name',
    'same',
  ]);
  const sameJson = same.status === 0 ? JSON.parse(same.stdout) : null;
  check('compare: identical images give 0% mismatch', sameJson?.mismatchRatio === 0, same.stderr);
  const theme = await run('compare.mjs', [
    '--expected',
    shot('001-good', 'desktop', 'light'),
    '--actual',
    shot('001-good', 'desktop', 'dark'),
    '--out',
    'cmp',
    '--name',
    'theme',
  ]);
  const themeJson = theme.status === 0 ? JSON.parse(theme.stdout) : null;
  check(
    'compare: light vs dark differ (themes really switch)',
    themeJson?.mismatchRatio > 0.3,
    theme.stdout || theme.stderr,
  );
  const diff = await run('compare.mjs', [
    '--expected',
    shot('001-good', 'desktop', 'light'),
    '--actual',
    shot('002-bad', 'desktop', 'light'),
    '--out',
    'cmp',
    '--name',
    'diff',
    '--fail-over',
    '0.001',
  ]);
  const diffJson = diff.stdout ? JSON.parse(diff.stdout) : null;
  check(
    'compare: different screens give a visible diff and --fail-over exits 1',
    diff.status === 1 && diffJson?.mismatchRatio > 0.005,
    diff.stdout || diff.stderr,
  );
  check(
    'compare: writes diff and side-by-side images',
    existsSync(path.join(work, 'cmp', 'diff.diff.png')) &&
      existsSync(path.join(work, 'cmp', 'diff.side-by-side.png')),
  );

  // design parity
  const designs = path.join(work, 'designs');
  ensureDir(path.join(designs, '001-good'));
  ensureDir(path.join(designs, '003-not-built'));
  copyFileSync(
    shot('001-good', 'desktop', 'light'),
    path.join(designs, '001-good', 'default--desktop--light.png'),
  );
  copyFileSync(
    shot('001-good', 'mobile', 'light'),
    path.join(designs, '001-good', 'default--mobile.png'),
  );
  copyFileSync(
    shot('001-good', 'desktop', 'light'),
    path.join(designs, '003-not-built', 'default--desktop--light.png'),
  );
  const parity = await run('design-parity.mjs', [
    '--captures',
    'capture',
    '--designs',
    designs,
    '--out',
    'parity',
  ]);
  const pj = json(path.join(work, 'parity', 'design-parity.json'));
  check(
    'design-parity: pairs designs with captures (theme-less name -> light)',
    parity.status === 0 &&
      pj?.compared.length === 2 &&
      pj.compared.every((r) => r.mismatchRatio === 0),
    parity.stderr || JSON.stringify(pj?.compared),
  );
  check(
    'design-parity: lists designs without a capture',
    pj?.notCaptured.some((f) => f.includes('003-not-built')),
  );
  check(
    'design-parity: lists captured screens without an approved design',
    pj?.noApprovedDesign.includes('002-bad'),
  );
  check(
    'design-parity: writes side-by-side images and a report',
    existsSync(path.join(work, 'parity', '001-good--default--desktop--light.side-by-side.png')) &&
      existsSync(path.join(work, 'parity', 'design-parity.md')),
  );

  // stitch-save
  const png = readFileSync(shot('001-good', 'desktop', 'light'));
  writeFileSync(
    path.join(work, 'download.json'),
    JSON.stringify({
      image: png.toString('base64'),
      image_metadata: { mime_type: 'image/png', width: 1440, height: 900 },
    }),
  );
  const target = path.join(designs, '004-saved', 'default--desktop--light.png');
  const saved = await run('stitch-save.mjs', [
    '--from',
    'download.json',
    '--out',
    target,
    '--screen-name',
    'projects/0/screens/0',
  ]);
  check(
    'stitch-save: writes the PNG and meta.json from a download_file result',
    saved.status === 0 &&
      existsSync(target) &&
      readFileSync(target).equals(png) &&
      existsSync(path.join(designs, '004-saved', 'meta.json')),
    saved.stderr,
  );
  const badName = await run(
    'stitch-save.mjs',
    ['--out', path.join(designs, 'budget', 'x.png')],
    png.toString('base64'),
  );
  check('stitch-save: rejects names without the screen-number convention', badName.status === 2);
} finally {
  server.close();
  if (args.keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

console.log(`visual self-test: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
