// Contact sheet: for each state, the changed content region of the old baseline and the new render,
// side by side (old | new), one state per row. Standard library only.
// Usage: node sheet.mjs <list.tsv: state<TAB>oldPath<TAB>newPath<TAB>bbox> <out.png> [maxW=560] [maxH=150]
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

function decode(path) {
  const buf = readFileSync(path);
  let pos = 8,
    w = 0,
    h = 0,
    bpp = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos),
      type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      bpp = body[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)),
    stride = w * bpp,
    out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const f = raw[i++],
      line = out.subarray(y * stride, (y + 1) * stride);
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

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const [list, out, mw, mh] = process.argv.slice(2);
const MAXW = Number(mw ?? 560),
  MAXH = Number(mh ?? 150),
  PAD = 10,
  GAP = 6,
  LABEL = 4;
const rows = readFileSync(list, 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split('\t'));
const tiles = rows.map(([, oldP, newP, bbox]) => {
  const A = decode(oldP),
    B = decode(newP);
  const [[x0, y0], [x1, y1]] = bbox.split('-').map((p) => p.split(',').map(Number));
  const cx0 = Math.max(0, x0 - PAD),
    cy0 = Math.max(0, y0 - PAD);
  const cw = Math.min(MAXW, Math.min(A.w, B.w) - cx0, x1 - x0 + 1 + 2 * PAD);
  const ch = Math.min(MAXH, Math.min(A.h, B.h) - cy0, y1 - y0 + 1 + 2 * PAD);
  return { A, B, cx0, cy0, cw, ch };
});
const W = 2 * MAXW + GAP + LABEL,
  H = tiles.reduce((s, t) => s + t.ch + GAP, 0);
const img = Buffer.alloc(W * H * 3, 255);
let oy = 0;
for (const t of tiles) {
  for (let y = 0; y < t.ch; y++) {
    for (const [src, ox] of [
      [t.A, LABEL],
      [t.B, LABEL + MAXW + GAP],
    ]) {
      for (let x = 0; x < t.cw; x++) {
        const si = ((t.cy0 + y) * src.w + (t.cx0 + x)) * src.bpp,
          di = ((oy + y) * W + ox + x) * 3;
        img[di] = src.px[si];
        img[di + 1] = src.px[si + 1];
        img[di + 2] = src.px[si + 2];
      }
    }
    for (let x = 0; x < GAP; x++) {
      const di = ((oy + y) * W + LABEL + MAXW + x) * 3;
      img[di] = 230;
      img[di + 1] = 0;
      img[di + 2] = 0;
    }
  }
  for (let x = 0; x < W; x++)
    for (let y = oy + t.ch; y < oy + t.ch + GAP; y++) {
      const di = (y * W + x) * 3;
      img[di] = 40;
      img[di + 1] = 40;
      img[di + 2] = 200;
    }
  oy += t.ch + GAP;
}
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`${out}: ${tiles.length} states, ${W}x${H}`);
