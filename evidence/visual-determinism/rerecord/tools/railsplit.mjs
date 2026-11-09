// Classifies every expected/actual pair a zero-allowance visual run saved: how many differing pixels
// fall in the navigation rail (x < RAIL) and how many in the content, plus the content bounding box.
// Usage: node classify.mjs <test-results-dir> [rail=56] > out.tsv
// Standard library only: Playwright screenshots are 8-bit RGB/RGBA, non-interlaced.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const [dir, railArg] = process.argv.slice(2);
const RAIL = Number(railArg ?? 56);

function decode(path) {
  const buf = readFileSync(path);
  let pos = 8,
    w = 0,
    h = 0,
    bpp = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      const depth = body[8],
        ctype = body[9],
        inter = body[12];
      if (depth !== 8 || (ctype !== 2 && ctype !== 6) || inter)
        throw new Error(`${path}: unsupported`);
      bpp = ctype === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const f = raw[i++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(line, 0, i, i + stride);
    i += stride;
    if (f === 1) for (let x = bpp; x < stride; x++) line[x] = (line[x] + line[x - bpp]) & 255;
    else if (f === 2) for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255;
    else if (f === 3)
      for (let x = 0; x < stride; x++)
        line[x] = (line[x] + (((x >= bpp ? line[x - bpp] : 0) + prev[x]) >> 1)) & 255;
    else if (f === 4)
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? line[x - bpp] : 0,
          b = prev[x],
          c = x >= bpp ? prev[x - bpp] : 0;
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    prev = line;
  }
  return { w, h, bpp, px: out };
}

process.stdout.write('state\tviewport\ttotal\trail\tcontent\tbbox\n');
for (const d of readdirSync(dir).sort()) {
  if (d.includes('retry') || !d.startsWith('visual-')) continue;
  const files = readdirSync(join(dir, d));
  const exp = files.find((f) => f.endsWith('-expected.png'));
  const act = files.find((f) => f.endsWith('-actual.png'));
  if (!exp || !act) continue;
  const name = exp.replace(/-expected\.png$/, '');
  const viewport = name.split('--').pop();
  try {
    const A = decode(join(dir, d, exp)),
      B = decode(join(dir, d, act));
    if (A.w !== B.w || A.h !== B.h) {
      process.stdout.write(`${name}\t${viewport}\tsize\t${A.w}x${A.h}\t${B.w}x${B.h}\t-\n`);
      continue;
    }
    let total = 0,
      rail = 0,
      x0 = 1e9,
      y0 = 1e9,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < A.h; y++)
      for (let x = 0; x < A.w; x++) {
        const ia = (y * A.w + x) * A.bpp,
          ib = (y * B.w + x) * B.bpp;
        if (
          A.px[ia] !== B.px[ib] ||
          A.px[ia + 1] !== B.px[ib + 1] ||
          A.px[ia + 2] !== B.px[ib + 2]
        ) {
          total++;
          if (x < RAIL) rail++;
          else {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    const bbox = x1 < 0 ? '-' : `${x0},${y0}-${x1},${y1}`;
    process.stdout.write(`${name}\t${viewport}\t${total}\t${rail}\t${total - rail}\t${bbox}\n`);
  } catch (e) {
    process.stdout.write(`${name}\t${viewport}\terror\t${e.message}\t\t\n`);
  }
}
