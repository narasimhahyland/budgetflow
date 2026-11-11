// For every baseline the recording changed, compare the recorded image with the renders the two
// measurement runs saved. Matches both: stable. Matches one: within run-to-run variation. Matches
// neither: a frame no other run produced - a suspect baseline. For a changed file whose state matched
// its old baseline in both runs (so no render was saved), compare with the old baseline instead.
// Usage: node verify-recorded.mjs <repo> <run2-dir> <run3-dir>   (prints TSV)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const [repo, run2, run3] = process.argv.slice(2);
const SHOTS = 'apps/web-e2e/src/__screenshots__/visual-light';

function decodeBuf(buf) {
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
const decode = (p) => decodeBuf(readFileSync(p));
function diff(A, B) {
  if (A.w !== B.w || A.h !== B.h) return -1;
  let n = 0;
  for (let y = 0; y < A.h; y++)
    for (let x = 0; x < A.w; x++) {
      const ia = (y * A.w + x) * A.bpp,
        ib = (y * B.w + x) * B.bpp;
      if (A.px[ia] !== B.px[ib] || A.px[ia + 1] !== B.px[ib + 1] || A.px[ia + 2] !== B.px[ib + 2])
        n++;
    }
  return n;
}
// index the runs' saved renders by state name
function index(dir) {
  const m = new Map();
  for (const d of readdirSync(dir)) {
    for (const f of readdirSync(join(dir, d)))
      if (f.endsWith('-actual.png')) m.set(f.slice(0, -11), join(dir, d, f));
  }
  return m;
}
const i2 = index(run2),
  i3 = index(run3);
const changed = execFileSync('git', ['-C', repo, 'status', '--short', SHOTS], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3).trim());
process.stdout.write('state\tvs_run2\tvs_run3\tvs_old\tverdict\n');
for (const rel of changed) {
  const state = rel
    .split('/')
    .pop()
    .replace(/\.png$/, '');
  const rec = decode(join(repo, rel));
  const r2 = i2.get(state),
    r3 = i3.get(state);
  const d2 = r2 ? diff(rec, decode(r2)) : null,
    d3 = r3 ? diff(rec, decode(r3)) : null;
  let dOld = null;
  if (d2 === null && d3 === null) {
    try {
      dOld = diff(rec, decodeBuf(execFileSync('git', ['-C', repo, 'show', `HEAD:${rel}`])));
    } catch {
      dOld = -2;
    }
  }
  let v;
  if (d2 === null && d3 === null)
    v = dOld === 0 ? 'same-pixels-as-old' : 'CHANGED-though-runs-matched-old';
  else if ((d2 ?? 0) === 0 && (d3 ?? 0) === 0) v = 'matches-runs';
  else if (d2 === 0 || d3 === 0) v = 'matches-one-run';
  else v = 'MATCHES-NEITHER';
  process.stdout.write(`${state}\t${d2 ?? '-'}\t${d3 ?? '-'}\t${dOld ?? '-'}\t${v}\n`);
}
