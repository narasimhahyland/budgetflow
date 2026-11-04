#!/usr/bin/env node
// Compares two PNGs (for example an approved Stitch design and a capture) and writes a diff image and a
// labelled side-by-side image (expected | actual | diff). Pixel comparison runs in a headless Chromium canvas,
// so the only dependency is Playwright. The mismatch ratio is advisory; people (or the agent) judge parity.
//
// Usage: node scripts/visual/compare.mjs --expected design.png --actual capture.png --out <dir> [--name x]
//          [--threshold 0.1] [--fail-over 0.02] [--labels "Design,Implementation"]
// Prints a JSON result. Exit 0, or 1 when --fail-over is given and the mismatch ratio exceeds it; 2 on errors.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolMissing, ensureDir, launchChromium, parseArgs, rel } from './lib.mjs';

const MAX_HEIGHT = 8000;

/** Compares two PNG files using an open Playwright page. Returns the result and writes <name>.diff.png and <name>.side-by-side.png. */
export async function compareImages(page, { expected, actual, outDir, name, threshold = 0.1, labels = ['Design', 'Implementation'] }) {
  const toUrl = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const res = await page.evaluate(
    async ({ e, a, threshold, labels, maxHeight }) => {
      const load = (src) => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => fail(new Error('image decode failed')); img.src = src; });
      const [ie, ia] = await Promise.all([load(e), load(a)]);
      const w = ia.naturalWidth;
      const scale = w / ie.naturalWidth;
      const eh = Math.round(ie.naturalHeight * scale);
      const h = Math.min(Math.max(ia.naturalHeight, eh), maxHeight);
      const canvas = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return [c, c.getContext('2d', { willReadFrequently: true })]; };
      const [ce, xe] = canvas(w, h);
      xe.fillStyle = '#fff'; xe.fillRect(0, 0, w, h); xe.drawImage(ie, 0, 0, w, eh);
      const [ca, xa] = canvas(w, h);
      xa.fillStyle = '#fff'; xa.fillRect(0, 0, w, h); xa.drawImage(ia, 0, 0);
      const de = xe.getImageData(0, 0, w, h).data;
      const da = xa.getImageData(0, 0, w, h).data;
      const [cd, xd] = canvas(w, h);
      const diff = xd.createImageData(w, h);
      const dd = diff.data;
      const limit = threshold * 255;
      let mismatched = 0;
      for (let i = 0; i < da.length; i += 4) {
        const delta = Math.max(Math.abs(de[i] - da[i]), Math.abs(de[i + 1] - da[i + 1]), Math.abs(de[i + 2] - da[i + 2]));
        if (delta > limit) {
          mismatched++;
          dd[i] = 220; dd[i + 1] = 30; dd[i + 2] = 60; dd[i + 3] = 255;
        } else {
          const g = 255 - (255 - (0.299 * da[i] + 0.587 * da[i + 1] + 0.114 * da[i + 2])) * 0.25;
          dd[i] = dd[i + 1] = dd[i + 2] = g; dd[i + 3] = 255;
        }
      }
      xd.putImageData(diff, 0, 0);
      const ratio = mismatched / (w * h);
      const gutter = 16;
      const bar = 36;
      const [cs, xs] = canvas(w * 3 + gutter * 2, h + bar);
      xs.fillStyle = '#ffffff'; xs.fillRect(0, 0, cs.width, cs.height);
      xs.fillStyle = '#1f1d3d'; xs.font = 'bold 18px sans-serif'; xs.textBaseline = 'middle';
      const titles = [labels[0], labels[1], `Diff ${(ratio * 100).toFixed(2)}% (threshold ${threshold})`];
      [ce, ca, cd].forEach((c, i) => { const x = i * (w + gutter); xs.fillText(titles[i], x + 8, bar / 2); xs.drawImage(c, x, bar); });
      return {
        diff: cd.toDataURL('image/png'),
        side: cs.toDataURL('image/png'),
        width: w,
        height: h,
        expectedSize: [ie.naturalWidth, ie.naturalHeight],
        actualSize: [ia.naturalWidth, ia.naturalHeight],
        mismatched,
        ratio,
        truncated: Math.max(ia.naturalHeight, eh) > maxHeight,
      };
    },
    { e: toUrl(expected), a: toUrl(actual), threshold, labels, maxHeight: MAX_HEIGHT },
  );
  ensureDir(outDir);
  const diffFile = path.join(outDir, `${name}.diff.png`);
  const sideFile = path.join(outDir, `${name}.side-by-side.png`);
  writeFileSync(diffFile, Buffer.from(res.diff.split(',')[1], 'base64'));
  writeFileSync(sideFile, Buffer.from(res.side.split(',')[1], 'base64'));
  const [ew, eh] = res.expectedSize;
  const [aw, ah] = res.actualSize;
  return {
    name,
    expected: rel(expected),
    actual: rel(actual),
    mismatchRatio: Number(res.ratio.toFixed(5)),
    mismatchedPixels: res.mismatched,
    comparedSize: [res.width, res.height],
    sizeMismatch: Math.abs(ew / eh - aw / ah) > 0.02,
    truncated: res.truncated,
    diff: rel(diffFile),
    sideBySide: rel(sideFile),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.expected || !args.actual || !args.out) {
    console.error('usage: compare.mjs --expected <png> --actual <png> --out <dir> [--name x] [--threshold 0.1] [--fail-over ratio]');
    process.exit(2);
  }
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const result = await compareImages(page, {
      expected: path.resolve(args.expected),
      actual: path.resolve(args.actual),
      outDir: path.resolve(args.out),
      name: args.name ?? path.basename(args.actual, '.png'),
      threshold: Number(args.threshold ?? 0.1),
      labels: args.labels ? String(args.labels).split(',') : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    const failOver = args['fail-over'] === undefined ? null : Number(args['fail-over']);
    process.exitCode = failOver !== null && result.mismatchRatio > failOver ? 1 : 0;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof ToolMissing ? `compare: ${err.message}` : `compare: ${err?.stack ?? err}`);
    process.exit(2);
  });
}
