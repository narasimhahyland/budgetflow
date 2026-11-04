#!/usr/bin/env node
// Builds the clickable design preview of the Stitch exports into design/preview/dist (design review only, not app code).
//
//   node design/preview/build.mjs [--out <dir>]
//   node design/preview/build.mjs import --from <file> --screen <NNN-slug> --state <state>
//   node design/preview/build.mjs report [--out <file>]
//
// Inputs: design/stitch/*/meta.json and PNGs (every exported state), design/preview/html/<screen>/<state>.html
// (Stitch HTML saved with `import`), design/preview/ocr/<screen>--<state>.json (text positions for states without
// HTML, written by ocr.swift) and design/preview/links.json (guided flow, areas, link map, extra hotspots).
// A state with saved HTML is served as that HTML with its links rewritten; any other state is served as its
// exported PNG with hotspots on the labels links.json knows about.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const stitchDir = join(root, 'design', 'stitch');
const htmlDir = join(here, 'html');
const ocrDir = join(here, 'ocr');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const die = (msg) => {
  console.error(`design-preview: ${msg}`);
  process.exit(1);
};

// ---------- text helpers ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', middot: '·', rarr: '→', larr: '←', times: '×', mdash: '—', ndash: '–' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Lowercase word tokens; "and" and punctuation are dropped so "Actuals & matching" equals "Actuals and matching". */
const tokens = (s) => decode(String(s ?? '')).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && t !== 'and');
const norm = (s) => tokens(s).join(' ');
const sentence = (slug) => slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ---------- inputs ----------
const links = JSON.parse(readFileSync(join(here, 'links.json'), 'utf8'));

function loadScreens() {
  const screens = [];
  for (const id of readdirSync(stitchDir).sort()) {
    const metaPath = join(stitchDir, id, 'meta.json');
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const states = [];
    for (const [file, info] of Object.entries(meta.files ?? {})) {
      const m = /^(.+?)--(desktop|tablet|mobile)(?:--(light|dark))?\.png$/.exec(file);
      if (!m || m[3] === 'dark') continue;
      states.push({ state: m[1], viewport: m[2], file, size: info.size, stitchScreen: info.stitchScreen, status: info.status ?? '' });
    }
    const seen = new Map();
    for (const s of states) seen.set(s.state, (seen.get(s.state) ?? 0) + 1);
    for (const s of states) if (seen.get(s.state) > 1 && s.viewport !== 'desktop') s.state = `${s.state}-${s.viewport}`;
    states.sort((a, b) => (a.state === 'default' ? -1 : b.state === 'default' ? 1 : 0));
    if (!states.length) continue;
    const number = id.split('-')[0];
    screens.push({ id, number, title: links.titles?.[id] ?? sentence(id.slice(number.length + 1)), states });
  }
  return screens;
}

const screens = loadScreens();
const pages = [];
const pageById = new Map();
for (const screen of screens) {
  for (const s of screen.states) {
    const id = `${screen.id}--${s.state}`;
    const html = join(htmlDir, screen.id, `${s.state}.html`);
    const ocr = join(ocrDir, `${id}.json`);
    const page = {
      id,
      screen,
      ...s,
      stateLabel: links.stateLabels?.[s.state] ?? sentence(s.state),
      png: join(stitchDir, screen.id, s.file),
      html: existsSync(html) ? html : null,
      ocr: existsSync(ocr) ? ocr : null,
    };
    page.mode = page.html ? 'html' : 'image';
    pages.push(page);
    pageById.set(id, page);
  }
}

/** "023-budget-hierarchy" or "023-budget-hierarchy/set-to-zero-dialog" to a page id; null when the ref is null. */
function ref(r, where) {
  if (r === null) return null;
  const [screenId, state] = String(r).split('/');
  const screen = screens.find((s) => s.id === screenId);
  if (!screen) die(`${where}: unknown screen "${screenId}" in links.json`);
  const s = state ? screen.states.find((x) => x.state === state) : screen.states[0];
  if (!s) die(`${where}: unknown state "${r}" in links.json`);
  return `${screen.id}--${s.state}`;
}

const journey = (links.journey ?? []).map((r) => ref(r, 'journey'));

/**
 * Label map for one page: global labels, then screen labels, then state labels (later wins). Keys are visible text;
 * "row:<text>" also matches inside longer rows, "icon:<name>" matches icon-only controls, and an empty-string target
 * removes an inherited label on that screen.
 */
function linkMap(page) {
  const map = new Map();
  for (const scope of ['*', page.screen.id, `${page.screen.id}/${page.state}`]) {
    for (const [label, target] of Object.entries(links.links?.[scope] ?? {})) {
      const [, prefix = '', text] = /^(?:(row|icon):)?(.*)$/.exec(label);
      const key = (prefix ? `${prefix}:` : '') + norm(text);
      if (!norm(text)) continue;
      if (target === '') map.delete(key);
      else map.set(key, { label: prefix === 'icon' ? sentence(text.replace(/_/g, '-')) : text, to: ref(target, `links["${scope}"]["${label}"]`) });
    }
  }
  return map;
}
const ignored = new Set((links.ignore ?? []).map(norm));

// Each state is a shell page (screens/<id>.html: navigation bar plus an iframe) around a frame page
// (frames/<id>.html: the Stitch HTML or exported image). Links inside frames open the next shell page in the top window.
const pageHref = (id, fromIndex = false) => (fromIndex ? `screens/${id}.html` : `${id}.html`);
const missingHref = (label) => `../index.html?missing=${encodeURIComponent(label)}`;
const targetHref = (hit) => (hit.to ? `../screens/${hit.to}.html` : missingHref(hit.label));

// ---------- minimal HTML tree (enough for Stitch exports) ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'stop']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

function parseAttrs(raw) {
  const attrs = {};
  for (const m of raw.matchAll(/([^\s=/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
    let v = m[2] ?? '';
    if (/^["']/.test(v)) v = v.slice(1, -1);
    attrs[m[1].toLowerCase()] = decode(v);
  }
  return attrs;
}

function parse(html) {
  const top = { tag: '#root', children: [], attrs: {} };
  const stack = [top];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m;
  const text = (s) => s.trim() && stack.at(-1).children.push({ tag: '#text', text: decode(s) });
  while ((m = re.exec(html))) {
    if (m.index > last) text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[0].startsWith('<!')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const i = stack.findLastIndex((n) => n.tag === tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const tag = m[2].toLowerCase();
    const node = { tag, attrs: parseAttrs(m[3]), attrsRaw: m[3], start: m.index, openEnd: re.lastIndex, selfClose: m[4] === '/', children: [] };
    stack.at(-1).children.push(node);
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      const end = close < 0 ? html.length : html.indexOf('>', close) + 1;
      node.raw = html.slice(re.lastIndex, close < 0 ? html.length : close);
      re.lastIndex = end;
      last = end;
      continue;
    }
    if (!VOID.has(tag) && !node.selfClose) stack.push(node);
  }
  return top;
}

const isIcon = (n) => /\bmaterial-(symbols|icons)/.test(n.attrs?.class ?? '');
const icons = (node, out = []) => {
  for (const c of node.children ?? []) {
    if (c.tag === '#text') continue;
    if (isIcon(c)) out.push(norm(c.children.map((t) => t.text ?? '').join(' ')));
    else icons(c, out);
  }
  return out;
};
function chunks(node, out = []) {
  for (const c of node.children ?? []) {
    if (c.tag === '#text') out.push(c.text.replace(/\s+/g, ' ').trim());
    else if (!isIcon(c) && !RAW.has(c.tag)) chunks(c, out);
  }
  return out.filter(Boolean);
}
function* walk(node) {
  for (const c of node.children ?? []) {
    if (c.tag === '#text') continue;
    yield c;
    yield* walk(c);
  }
}
const interactive = (n) =>
  ['a', 'button', 'tr'].includes(n.tag) ||
  ['button', 'link', 'tab', 'menuitem', 'option'].includes(n.attrs.role) ||
  (/\bcursor-pointer\b/.test(n.attrs.class ?? '') && !['input', 'label', 'select'].includes(n.tag));

function resolveElement(n, map) {
  const parts = chunks(n);
  const full = norm(parts.join(' '));
  const label = parts.join(' ').trim() || n.attrs.title || n.attrs['aria-label'] || '';
  const tries = [full, full.replace(/\s\d+$/, ''), norm(n.attrs.title), norm(n.attrs['aria-label'])];
  if (n.tag !== 'tr' && full.length <= 120) tries.push(...parts.map(norm));
  for (const t of tries) if (t && map.has(t)) return { label, hit: map.get(t) };
  if (full.length <= 400) {
    for (const [key, hit] of map) {
      if (key.startsWith('row:') && ` ${full} `.includes(` ${key.slice(4)} `)) return { label, hit };
    }
  }
  if (full.length <= 3) for (const i of icons(n)) if (map.has(`icon:${i}`)) return { label: label || i, hit: map.get(`icon:${i}`) };
  return { label, hit: null };
}

function rewriteHtml(page, html) {
  const map = linkMap(page);
  const tree = parse(html);
  const ids = new Set([...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
  const deadHref = (href) => !href || href === '#' || (href.startsWith('#') && !ids.has(href.slice(1)));
  const edits = [];
  const report = { linked: [], missing: [] };
  for (const n of walk(tree)) {
    if (!interactive(n)) continue;
    const { label, hit } = resolveElement(n, map);
    if (ignored.has(norm(label))) continue;
    let extra = null;
    if (hit) {
      extra = n.tag === 'a' ? `href="${esc(targetHref(hit))}" target="_top"` : `data-bf-href="${esc(targetHref(hit))}"`;
      extra += hit.to ? ` data-bf-to="${hit.to}"` : ` data-bf-missing="${esc(hit.label)}"`;
      report.linked.push(`${label.slice(0, 50)} -> ${hit.to ?? 'not designed yet'}`);
    } else if (n.tag === 'a' && deadHref(n.attrs.href)) {
      extra = `href="${esc(missingHref(label || 'This link'))}" target="_top" data-bf-missing="${esc(label || 'This link')}"`;
      report.missing.push(`a: ${label.slice(0, 50)}`);
    } else if (n.tag !== 'tr' && n.tag !== 'a') {
      extra = `data-bf-missing="${esc(label.slice(0, 80) || 'This control')}"`;
      report.missing.push(`${n.tag}: ${label.slice(0, 50)}`);
    }
    if (!extra) continue;
    const attrs = n.tag === 'a' ? n.attrsRaw.replace(/\s+(href|target)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, '') : n.attrsRaw;
    edits.push({ start: n.start, end: n.openEnd, text: `<${n.tag}${attrs.replace(/\s*$/, '')} ${extra}${n.selfClose ? '/' : ''}>` });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const head = '<link rel="stylesheet" href="../assets/overlay.css"/>';
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${head}</head>`) : head + out;
  const tail = '<script src="../assets/frame.js"></script>';
  const bodyEnd = out.toLowerCase().lastIndexOf('</body>');
  out = bodyEnd < 0 ? out + tail : out.slice(0, bodyEnd) + tail + out.slice(bodyEnd);
  return { out, report };
}

// ---------- image pages ----------
function ocrHotspots(page, map) {
  if (!page.ocr) return [];
  const ocr = JSON.parse(readFileSync(page.ocr, 'utf8'));
  const found = [];
  for (const line of ocr.lines) {
    // All-caps lines are sidebar group headings and table headers, not links.
    if (/[A-Z]{3}/.test(line.text) && line.text === line.text.toUpperCase()) continue;
    const words = line.words.map((w) => ({ t: tokens(w.t), box: w.box })).filter((w) => w.t.length);
    const flat = [];
    for (const w of words) for (const t of w.t) flat.push({ t, box: w.box });
    const lineKey = flat.map((w) => w.t).join(' ');
    // Icon glyphs often come back as a short leading token ("2 Approval inbox", "Il Reports"); badges as a trailing number.
    const keys = [lineKey, lineKey.replace(/\s\d+$/, '')];
    if (flat.length > 1 && flat[0].t.length <= 2) keys.push(...keys.map((k) => k.slice(k.indexOf(' ') + 1)));
    const whole = keys.map((k) => map.get(k)).find(Boolean);
    if (whole) {
      found.push({ hit: whole, box: line.box });
      continue;
    }
    // Labels inside a longer line: breadcrumb segments ("Home / Budgets") and row labels ("row:" keys).
    const crumb = /\s[/›>]\s/.test(line.text);
    const used = new Set();
    const keysLongestFirst = [...map.keys()].sort((a, b) => b.split(' ').length - a.split(' ').length);
    for (const key of keysLongestFirst) {
      const hit = map.get(key);
      const row = key.startsWith('row:');
      if (!row && !crumb) continue;
      const want = (row ? key.slice(4) : key).split(' ');
      for (let i = 0; i + want.length <= flat.length; i++) {
        if (want.every((t, j) => flat[i + j].t === t && !used.has(i + j))) {
          want.forEach((_, j) => used.add(i + j));
          const bs = flat.slice(i, i + want.length).map((w) => w.box);
          const x = Math.min(...bs.map((b) => b[0]));
          const y = Math.min(...bs.map((b) => b[1]));
          found.push({ hit, box: [x, y, Math.max(...bs.map((b) => b[0] + b[2])) - x, Math.max(...bs.map((b) => b[1] + b[3])) - y] });
          break;
        }
      }
    }
  }
  return found.map(({ hit, box }) => ({ hit, box, w: ocr.width, h: ocr.height }));
}

function imagePage(page) {
  const map = linkMap(page);
  const [W, H] = page.size;
  const scale = W >= 800 ? 2 : 1;
  const spots = [];
  const pad = 10;
  for (const s of ocrHotspots(page, map)) {
    const [x, y, w, h] = s.box;
    spots.push({ hit: s.hit, x: Math.max(0, x - pad), y: Math.max(0, y - pad), w: w + 2 * pad, h: h + 2 * pad });
  }
  for (const extra of links.hotspots?.[`${page.screen.id}/${page.state}`] ?? []) {
    const [x, y, w, h] = extra.box.map((v) => v * scale);
    spots.push({ hit: { label: extra.label, to: ref(extra.to, `hotspots["${page.screen.id}/${page.state}"]`) }, x, y, w, h });
  }
  const uniq = new Map();
  for (const s of spots) uniq.set(`${Math.round(s.x / 8)}:${Math.round(s.y / 8)}:${s.hit.to}`, s);
  const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;
  const anchors = [...uniq.values()]
    .map(
      (s) =>
        `<a class="bf-hotspot" href="${esc(targetHref(s.hit))}" target="_top" style="left:${pct(s.x, W)};top:${pct(s.y, H)};width:${pct(s.w, W)};height:${pct(s.h, H)}" title="${esc(s.hit.label)}" aria-label="${esc(s.hit.label)}"${s.hit.to ? ` data-bf-to="${s.hit.to}"` : ` data-bf-missing="${esc(s.hit.label)}"`}></a>`,
    )
    .join('\n');
  const maxW = page.viewport === 'desktop' ? W : W / scale;
  const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(page.screen.number)} ${esc(page.screen.title)} (${esc(page.stateLabel)}) - BudgetFlow design preview</title>
<link rel="stylesheet" href="../assets/overlay.css"/>
</head>
<body class="bf-image-page">
<main class="bf-canvas" style="max-width:${maxW}px">
<img src="../images/${page.id}.png" width="${W / scale}" height="${H / scale}" alt="${esc(page.screen.title)}, ${esc(page.stateLabel)} (exported Stitch design)"/>
${anchors}
</main>
<script src="../assets/frame.js"></script>
</body>
</html>
`;
  return { out, report: { linked: [...uniq.values()].map((s) => `${s.hit.label} -> ${s.hit.to ?? 'not designed yet'}`), missing: [] } };
}

// ---------- shell page (navigation bar + frame) ----------
function shellPage(page) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(page.screen.number)} ${esc(page.screen.title)} (${esc(page.stateLabel)}) - BudgetFlow design preview</title>
<link rel="stylesheet" href="../assets/shell.css"/>
</head>
<body class="bf-shell">
<iframe id="bf-frame" src="../frames/${page.id}.html" title="${esc(page.screen.number)} ${esc(page.screen.title)}, ${esc(page.stateLabel)}"></iframe>
${pageScript(page)}
</body>
</html>
`;
}

function pageScript(page) {
  const j = journey.indexOf(page.id);
  const step = (id) => (id ? { href: pageHref(id), title: `${pageById.get(id).screen.number} ${pageById.get(id).screen.title} (${pageById.get(id).stateLabel})` } : null);
  const resume = journey.find((id) => pageById.get(id).screen.id === page.screen.id) ?? journey[0];
  const data = {
    id: page.id,
    number: page.screen.number,
    title: page.screen.title,
    state: page.state,
    stateLabel: page.stateLabel,
    mode: page.mode,
    states: page.screen.states.map((s) => ({ label: links.stateLabels?.[s.state] ?? sentence(s.state), href: pageHref(`${page.screen.id}--${s.state}`), current: s.state === page.state })),
    step: j >= 0 ? j + 1 : null,
    steps: journey.length,
    prev: j > 0 ? step(journey[j - 1]) : null,
    next: j >= 0 && j < journey.length - 1 ? step(journey[j + 1]) : null,
    resume: j < 0 ? step(resume) : null,
    index: '../index.html',
  };
  return `<script>window.BF_PAGE=${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script src="../assets/overlay.js"></script>`;
}

// ---------- index ----------
function indexPage() {
  const areas = (links.areas ?? []).map((a) => ({ ...a, screens: a.screens.filter((id) => screens.some((s) => s.id === id)) }));
  const listed = new Set(areas.flatMap((a) => a.screens));
  const rest = screens.filter((s) => !listed.has(s.id)).map((s) => s.id);
  if (rest.length) areas.push({ name: 'Other screens', screens: rest });
  const card = (id) => {
    const screen = screens.find((s) => s.id === id);
    const first = `${screen.id}--${screen.states[0].state}`;
    const chips = screen.states
      .map((s) => {
        const p = pageById.get(`${screen.id}--${s.state}`);
        return `<a class="chip" href="${pageHref(p.id, true)}" title="${p.mode === 'html' ? 'Exported HTML' : 'Exported image with hotspots'}">${esc(p.stateLabel)}${p.mode === 'image' ? ' <span aria-hidden="true">◧</span>' : ''}</a>`;
      })
      .join('');
    const inFlow = journey.some((j) => pageById.get(j).screen.id === screen.id);
    return `<article class="card">
<a class="thumb" href="${pageHref(first, true)}"><img loading="lazy" src="thumbs/${first}.png" alt=""/></a>
<div class="meta"><h3><a href="${pageHref(first, true)}"><span class="num">${esc(screen.number)}</span> ${esc(screen.title)}</a></h3>
${inFlow ? '<span class="flow">In the guided flow</span>' : ''}
<div class="chips">${chips}</div></div>
</article>`;
  };
  const sections = areas.map((a) => `<section><h2>${esc(a.name)}</h2><div class="grid">${a.screens.map(card).join('\n')}</div></section>`).join('\n');
  const placeholders = [...new Set(Object.entries(links.links ?? {}).flatMap(([, m]) => Object.entries(m).filter(([, t]) => t === null).map(([l]) => l.replace(/^row:/, ''))))].sort();
  const htmlCount = pages.filter((p) => p.mode === 'html').length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>BudgetFlow - clickable design preview</title>
<link rel="stylesheet" href="assets/index.css"/>
</head>
<body>
<header class="hero">
<div>
<p class="eyebrow">BudgetFlow Enterprise</p>
<h1>Clickable design preview</h1>
<p class="lede">Proposed Stitch designs, light theme, linked into a flow you can click through. Sidebar items, primary buttons, table rows and dialog triggers open the matching screen or state. This is a design review artifact, not the product.</p>
<p class="actions"><a class="primary" href="${pageHref(journey[0], true)}">Start the guided flow</a><span class="hint">${journey.length} steps · ← → keys move along the flow · press L on a screen to highlight its links</span></p>
</div>
</header>
<main>
${sections}
<section class="notes">
<h2>About this preview</h2>
<p>${pages.length} screen states from ${screens.length} screens. ${htmlCount} states use the HTML Stitch exported; the others (marked ◧) use the exported image with clickable hotspots. Anything without a design yet shows a "not designed yet" notice.</p>
<p class="small">Not designed yet: ${placeholders.map(esc).join(', ') || 'none'}.</p>
</section>
</main>
<div id="toast" class="toast" role="status" hidden></div>
<script>
(() => {
  const missing = new URLSearchParams(location.search).get('missing');
  if (!missing) return;
  const t = document.getElementById('toast');
  t.textContent = '"' + missing.slice(0, 80) + '" is not designed yet. Pick a designed screen below.';
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 6000);
})();
</script>
</body>
</html>
`;
}

// ---------- commands ----------
function thumb(src, dest) {
  try {
    execFileSync('sips', ['--resampleWidth', '560', src, '--out', dest], { stdio: 'ignore' });
  } catch {
    copyFileSync(src, dest);
  }
}

function build() {
  const out = resolve(opt('--out', join(here, 'dist')));
  rmSync(out, { recursive: true, force: true });
  for (const d of ['screens', 'frames', 'images', 'thumbs', 'assets']) mkdirSync(join(out, d), { recursive: true });
  for (const f of readdirSync(join(here, 'assets'))) copyFileSync(join(here, 'assets', f), join(out, 'assets', f));
  const summary = [];
  for (const page of pages) {
    const result = page.mode === 'html' ? rewriteHtml(page, readFileSync(page.html, 'utf8')) : imagePage(page);
    if (page.mode === 'image') copyFileSync(page.png, join(out, 'images', `${page.id}.png`));
    writeFileSync(join(out, 'frames', `${page.id}.html`), result.out);
    writeFileSync(join(out, 'screens', `${page.id}.html`), shellPage(page));
    thumb(page.png, join(out, 'thumbs', `${page.id}.png`));
    summary.push({ page: page.id, mode: page.mode, linked: result.report.linked.length, notDesigned: result.report.missing.length });
  }
  writeFileSync(join(out, 'index.html'), indexPage());
  writeFileSync(join(out, '.nojekyll'), '');
  writeFileSync(join(out, 'pages.json'), JSON.stringify(summary, null, 2));
  const images = pages.filter((p) => p.mode === 'image');
  const noOcr = images.filter((p) => !p.ocr).map((p) => p.id);
  console.log(`design-preview: built ${pages.length} pages (${pages.length - images.length} HTML, ${images.length} image) into ${out}`);
  if (noOcr.length) console.log(`design-preview: no OCR yet (only links.json hotspots): ${noOcr.join(', ')}`);
}

function importHtml() {
  const from = opt('--from');
  const screenId = opt('--screen');
  const state = opt('--state');
  if (!from || !screenId || !state) die('usage: build.mjs import --from <file> --screen <NNN-slug> --state <state>');
  if (!pageById.has(`${screenId}--${state}`)) die(`no exported state ${screenId}/${state} in design/stitch (check meta.json)`);
  let html = readFileSync(from, 'utf8');
  if (html.trimStart().startsWith('{')) html = JSON.parse(html).html ?? die(`${from} has no "html" field`);
  if (!/<html[\s>]/i.test(html)) die(`${from} does not look like HTML`);
  mkdirSync(join(htmlDir, screenId), { recursive: true });
  writeFileSync(join(htmlDir, screenId, `${state}.html`), html);
  console.log(`design-preview: saved design/preview/html/${screenId}/${state}.html (${html.length} bytes)`);
}

function report() {
  const lines = [];
  for (const page of pages) {
    const result = page.mode === 'html' ? rewriteHtml(page, readFileSync(page.html, 'utf8')) : imagePage(page);
    lines.push(`## ${page.id} [${page.mode}${page.mode === 'image' && !page.ocr ? ', no OCR' : ''}]`);
    lines.push(...result.report.linked.map((l) => `  + ${l}`), ...result.report.missing.map((l) => `  - ${l}`));
  }
  const file = opt('--out');
  if (file) writeFileSync(file, lines.join('\n') + '\n');
  else console.log(lines.join('\n'));
}

const commands = { build, import: importHtml, report };
const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'build';
if (!commands[cmd]) die(`unknown command ${cmd}`);
commands[cmd]();
