#!/usr/bin/env node
// Pairs approved Stitch exports with captured screenshots and writes side-by-side and diff images plus a report.
// Design files: design/stitch/<NNN-slug>/<state>--<viewport>--<theme>.png (or <state>--<viewport>.png, compared
// with the light capture). Captures: <captures>/screens/<NNN-slug>--<state>--<viewport>--<theme>.png.
//
// Usage: node scripts/visual/design-parity.mjs --captures <capture dir> [--designs design/stitch]
//          [--out <capture dir>/design-parity] [--advisory 0.15] [--threshold 0.1] [--only 005,007] [--themes light]
// The ratio is advisory: rows above --advisory are marked "inspect closely"; the agent's inspection decides.
// Themes default to light only (dark theme deferred); dark designs are compared only when dark is enabled.
// Exit 0 (advisory), 2 on errors.
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareImages } from './compare.mjs';
import {
  ROOT,
  ToolMissing,
  ensureDir,
  exists,
  launchChromium,
  list,
  parseArgs,
  rel,
  themesFrom,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.captures) {
  console.error(
    'usage: design-parity.mjs --captures <capture dir> [--designs design/stitch] [--out dir] [--advisory 0.15] [--themes light]',
  );
  process.exit(2);
}
const captures = path.resolve(args.captures);
const designs = path.resolve(args.designs ?? path.join(ROOT, 'design/stitch'));
const outDir = path.resolve(args.out ?? path.join(captures, 'design-parity'));
const advisory = Number(args.advisory ?? 0.15);
const threshold = Number(args.threshold ?? 0.1);
const only = list(args.only);
const themes = themesFrom(args.themes);
const DESIGN =
  /^(?<state>[a-z0-9-]+)--(?<viewport>desktop|tablet|mobile)(?:--(?<theme>light|dark))?\.png$/;

function pairs() {
  const found = [];
  const unmatched = [];
  if (!exists(designs)) return { found, unmatched };
  for (const entry of readdirSync(designs, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{3}[a-z]?-[a-z0-9-]+$/.test(entry.name)) continue;
    if (only.length && !only.some((o) => entry.name === o || entry.name.startsWith(`${o}-`)))
      continue;
    for (const file of readdirSync(path.join(designs, entry.name))) {
      const m = DESIGN.exec(file);
      if (!m) continue;
      const { state, viewport } = m.groups;
      const theme = m.groups.theme ?? 'light';
      if (!themes.includes(theme)) continue;
      const capture = path.join(
        captures,
        'screens',
        `${entry.name}--${state}--${viewport}--${theme}.png`,
      );
      const item = {
        id: entry.name,
        state,
        viewport,
        theme,
        design: path.join(designs, entry.name, file),
        capture,
      };
      (exists(capture) ? found : unmatched).push(item);
    }
  }
  return { found, unmatched };
}

async function main() {
  const { found, unmatched } = pairs();
  ensureDir(outDir);
  const rows = [];
  if (found.length) {
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      for (const p of found) {
        const name = `${p.id}--${p.state}--${p.viewport}--${p.theme}`;
        const r = await compareImages(page, {
          expected: p.design,
          actual: p.capture,
          outDir,
          name,
          threshold,
          labels: ['Approved Stitch design', 'Implementation'],
        });
        rows.push({ ...p, ...r, inspect: r.mismatchRatio > advisory || r.sizeMismatch });
      }
    } finally {
      await browser.close();
    }
  }
  const capturedIds = exists(path.join(captures, 'screens'))
    ? [...new Set(readdirSync(path.join(captures, 'screens')).map((f) => f.split('--')[0]))]
    : [];
  const designIds = exists(designs) ? readdirSync(designs) : [];
  const noDesign = capturedIds.filter((id) => !designIds.includes(id));

  const report = {
    generatedAt: new Date().toISOString(),
    designs: rel(designs),
    captures: rel(captures),
    advisory,
    threshold,
    compared: rows,
    notCaptured: unmatched.map((u) => rel(u.design)),
    noApprovedDesign: noDesign,
  };
  writeFileSync(path.join(outDir, 'design-parity.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = [
    '# Design parity (advisory)',
    '',
    `Approved designs: \`${rel(designs)}\`. Pixel threshold ${threshold}; rows above ${(advisory * 100).toFixed(0)}% mismatch or with a different aspect ratio are marked to inspect closely. The ratio never decides parity on its own: open each side-by-side image and judge layout, hierarchy, component choice, copy and the budget-safety visual rules.`,
    '',
    '| Screen | State | Viewport | Theme | Mismatch | Inspect closely | Side by side |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.state} | ${r.viewport} | ${r.theme} | ${(r.mismatchRatio * 100).toFixed(2)}% | ${r.inspect ? 'yes' : 'no'} | ${path.basename(r.sideBySide)} |`,
    ),
    '',
    `Designs without a matching capture: ${report.notCaptured.length ? report.notCaptured.join(', ') : 'none'}.`,
    `Captured screens without an approved design: ${noDesign.length ? noDesign.join(', ') : 'none'}.`,
    '',
  ];
  writeFileSync(path.join(outDir, 'design-parity.md'), md.join('\n'));
  console.log(
    `design-parity: ${rows.length} compared, ${rows.filter((r) => r.inspect).length} to inspect closely, ${unmatched.length} designs not captured, ${noDesign.length} screens without design -> ${rel(path.join(outDir, 'design-parity.md'))}`,
  );
}

main().catch((err) => {
  console.error(
    err instanceof ToolMissing
      ? `design-parity: ${err.message}`
      : `design-parity: ${err?.stack ?? err}`,
  );
  process.exit(2);
});
