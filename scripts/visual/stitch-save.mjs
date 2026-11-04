#!/usr/bin/env node
// Saves an approved Stitch screenshot under design/stitch/<NNN-slug>/<state>--<viewport>--<theme>.png.
// Input: the JSON result of the Stitch MCP `download_file` tool (an `image` field with base64 bytes and
// `image_metadata`), raw base64, or a data URL — from --from <file> or stdin. JPEG input is converted to PNG
// (needs Playwright). Also records the source in design/stitch/<NNN-slug>/meta.json.
//
// Usage: node scripts/visual/stitch-save.mjs --out design/stitch/045-budget-hierarchy/default--desktop--light.png
//          [--from <download_file result.json>] [--screen-name projects/<p>/screens/<s>] [--approved 2026-11-04]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ToolMissing, ensureDir, exists, launchChromium, parseArgs, readJson, rel } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const usage = 'usage: stitch-save.mjs --out design/stitch/<NNN-slug>/<state>--<viewport>--<theme>.png [--from file] [--screen-name name] [--approved YYYY-MM-DD]';
if (!args.out) {
  console.error(usage);
  process.exit(2);
}
const out = path.resolve(args.out);
const screenDir = path.basename(path.dirname(out));
if (!/^\d{3}[a-z]?-[a-z0-9-]+$/.test(screenDir) || !/^[a-z0-9-]+--(desktop|tablet|mobile)(--(light|dark))?\.png$/.test(path.basename(out))) {
  console.error(`stitch-save: path must look like design/stitch/045-budget-hierarchy/default--desktop--light.png (screen number first)\n${usage}`);
  process.exit(2);
}

function findImage(value) {
  if (Array.isArray(value)) return value.map(findImage).find(Boolean) ?? null;
  if (value && typeof value === 'object') {
    if (typeof value.image === 'string') return { data: value.image, mime: value.image_metadata?.mime_type ?? value.mimeType };
    if (typeof value.data === 'string' && /image\//.test(value.mimeType ?? value.mime_type ?? '')) return { data: value.data, mime: value.mimeType ?? value.mime_type };
    return Object.values(value).map(findImage).find(Boolean) ?? null;
  }
  return null;
}

async function toPng(bytes, mime) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    const url = await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('image decode failed')); img.src = src; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    }, `data:${mime};base64,${bytes.toString('base64')}`);
    return Buffer.from(url.split(',')[1], 'base64');
  } finally {
    await browser.close();
  }
}

async function main() {
  const raw = (args.from ? readFileSync(args.from, 'utf8') : readFileSync(0, 'utf8')).trim();
  let found = { data: raw, mime: undefined };
  if (raw.startsWith('{') || raw.startsWith('[')) {
    found = findImage(JSON.parse(raw));
    if (!found) {
      console.error('stitch-save: no "image" field found in the JSON');
      process.exit(1);
    }
  }
  const dataUrlMime = /^data:(image\/[a-z]+);base64,/.exec(found.data)?.[1];
  let bytes = Buffer.from(found.data.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s+/g, ''), 'base64');
  const isPng = bytes.subarray(1, 4).toString('ascii') === 'PNG';
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) {
    console.error('stitch-save: decoded bytes are neither PNG nor JPEG');
    process.exit(1);
  }
  if (isJpeg) bytes = await toPng(bytes, dataUrlMime ?? found.mime ?? 'image/jpeg');
  ensureDir(path.dirname(out));
  writeFileSync(out, bytes);

  const metaFile = path.join(path.dirname(out), 'meta.json');
  const meta = exists(metaFile) ? readJson(metaFile) : { screen: screenDir, files: {} };
  meta.files[path.basename(out)] = {
    stitchScreen: args['screen-name'] ?? meta.files[path.basename(out)]?.stitchScreen ?? null,
    approved: args.approved ?? new Date().toISOString().slice(0, 10),
    size: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)],
  };
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`saved ${rel(out)} (${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}, ${bytes.length} bytes); updated ${rel(metaFile)}`);
}

main().catch((err) => {
  console.error(err instanceof ToolMissing ? `stitch-save: ${err.message}` : `stitch-save: ${err?.stack ?? err}`);
  process.exit(2);
});
