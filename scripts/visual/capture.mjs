#!/usr/bin/env node
// Captures every screen state at each viewport x theme and collects findings: console errors, page errors,
// failed requests, horizontal overflow, unrendered template interpolation and layout shift.
//
// Usage: node scripts/visual/capture.mjs --screens apps/web-e2e/visual/screens.json --out <dir>
//          [--base http://localhost:4200] [--only 005,007-approval-inbox] [--viewports desktop,tablet,mobile]
//          [--themes light] [--auth-dir tmp/e2e-auth] [--workers 3] [--quiet]
// Themes default to light only (dark theme deferred); --themes light,dark or BF_VISUAL_THEMES re-enables dark.
// Writes <out>/screens/<id>--<state>--<viewport>--<theme>.png, <out>/report.json and <out>/report.md.
// Exit: 0 no blocking findings, 1 blocking findings, 2 usage or tooling error.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  ToolMissing,
  VIEWPORTS,
  captureName,
  ensureDir,
  exists,
  launchChromium,
  list,
  parseArgs,
  pool,
  readJson,
  rel,
  themesFrom,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), ['quiet']);
if (!args.screens || !args.out) {
  console.error(
    'usage: capture.mjs --screens <screens.json> --out <dir> [--base URL] [--only ids] [--viewports ...] [--themes ...]',
  );
  process.exit(2);
}

const config = readJson(args.screens);
const base = String(
  args.base ?? process.env.BASE_URL ?? config.baseURL ?? 'http://localhost:4200',
).replace(/\/$/, '');
const outDir = path.resolve(args.out);
const authDir = path.resolve(ROOT, args['auth-dir'] ?? config.authDir ?? 'tmp/e2e-auth');
const viewports = list(args.viewports, Object.keys(VIEWPORTS));
const themes = themesFrom(args.themes, config);
const only = list(args.only);
const ignoreConsole = (config.ignore?.console ?? []).map((s) => new RegExp(s));
const ignoreRequests = (config.ignore?.requests ?? []).map((s) => new RegExp(s));

for (const v of viewports)
  if (!VIEWPORTS[v]) {
    console.error(`unknown viewport ${v}`);
    process.exit(2);
  }

const NO_MOTION_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

const screens = (config.screens ?? []).filter(
  (s) => !only.length || only.some((o) => s.id === o || s.id.startsWith(`${o}-`)),
);
if (!screens.length) {
  console.error('no screens matched');
  process.exit(2);
}

const jobs = [];
for (const screen of screens) {
  for (const state of screen.states ?? [{ state: 'default' }]) {
    for (const viewport of viewports)
      for (const theme of themes) jobs.push({ screen, state, viewport, theme });
  }
}

/** Runs inside the page once it is ready: horizontal overflow, interpolation leftovers, layout shift. */
function pageChecks() {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const overflowPx = Math.max(0, doc.scrollWidth - vw);
  const offenders = [];
  if (overflowPx > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1))
        offenders.push(`${describe(el)} (${Math.round(r.left)}..${Math.round(r.right)})`);
      if (offenders.length >= 5) break;
    }
  }
  const interpolation = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const parent = n.parentElement;
    if (
      !t ||
      !parent ||
      ['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(parent.tagName) ||
      !parent.getClientRects().length
    )
      continue;
    if (/\{\{|\}\}/.test(t)) interpolation.add(t.slice(0, 60));
  }
  return {
    overflowPx,
    offenders,
    interpolation: [...interpolation].slice(0, 10),
    cls: window.__bfCls ?? 0,
  };
}

async function runJob(browser, job) {
  const { screen, state, viewport, theme } = job;
  const stateName = state.state ?? 'default';
  const file = path.join(
    outDir,
    'screens',
    `${captureName({ id: screen.id, state: stateName, viewport, theme })}.png`,
  );
  const findings = [];
  const add = (type, severity, message, detail) =>
    findings.push({ type, severity, message, ...(detail ? { detail } : {}) });
  const result = { id: screen.id, state: stateName, viewport, theme, file: rel(file), findings };

  const role = state.role ?? screen.role;
  const storageState = role ? path.join(authDir, `${role}.json`) : undefined;
  if (storageState && !exists(storageState)) {
    add(
      'auth-missing',
      'blocking',
      `no saved sign-in for role "${role}" (${rel(storageState)}); run the Playwright auth setup project first`,
    );
    return result;
  }

  const context = await browser.newContext({
    ...VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: config.locale ?? 'en-US',
    timezoneId: config.timezone ?? 'UTC',
    storageState,
  });
  const storage = { ...(config.storage ?? {}), ...(state.storage ?? {}) };
  if (config.theme?.storageKey) storage[config.theme.storageKey] = config.theme[theme] ?? theme;
  await context.addInitScript(
    ({ storage, theme }) => {
      try {
        for (const [k, v] of Object.entries(storage))
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      } catch {}
      window.__bfCls = 0;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__bfCls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      // Set before first paint so the theme switch itself never registers as a layout shift.
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.colorScheme = theme;
      });
    },
    { storage, theme },
  );
  const page = await context.newPage();
  if (config.freezeTime) await page.clock.setFixedTime(new Date(config.freezeTime));
  const allowRequests = [
    ...ignoreRequests,
    ...(state.allowRequests ?? []).map((s) => new RegExp(s)),
  ];
  page.on('console', (m) => {
    if (m.type() !== 'error' || ignoreConsole.some((r) => r.test(m.text()))) return;
    // The browser logs every 4xx as "Failed to load resource"; a request the state expects to fail
    // (allowRequests) is not a finding, any other one still is.
    const url = m.location()?.url ?? '';
    if (/^Failed to load resource/.test(m.text()) && allowRequests.some((x) => x.test(url))) return;
    add('console-error', 'blocking', m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => add('page-error', 'blocking', String(e?.message ?? e).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? 'failed';
    if (allowRequests.some((x) => x.test(r.url()))) return;
    add(
      'request-failed',
      /ERR_ABORTED/.test(why) ? 'warning' : 'blocking',
      `${r.method()} ${r.url()} ${why}`,
    );
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !allowRequests.some((x) => x.test(r.url())))
      add('request-failed', 'blocking', `${r.request().method()} ${r.url()} HTTP ${r.status()}`);
  });

  try {
    await page.goto(`${base}${state.path ?? screen.path ?? '/'}`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    const waitFor = state.waitFor ?? screen.waitFor;
    if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 15000 });
    for (const action of state.actions ?? []) {
      if (action.click) await page.locator(action.click).first().click();
      else if (action.fill) await page.locator(action.fill[0]).first().fill(String(action.fill[1]));
      else if (action.select)
        await page.locator(action.select[0]).first().selectOption(String(action.select[1]));
      else if (action.hover) await page.locator(action.hover).first().hover();
      else if (action.press) await page.keyboard.press(action.press);
      else if (action.waitFor)
        await page.locator(action.waitFor).first().waitFor({ state: 'visible', timeout: 15000 });
      else if (action.scrollTop)
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('*')) el.scrollTop = 0;
          window.scrollTo(0, 0);
        });
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() =>
      document.fonts.ready.then(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      ),
    );
    const checks = await page.evaluate(pageChecks);
    await page.addStyleTag({ content: NO_MOTION_CSS });

    if (checks.overflowPx > 1)
      add(
        'overflow',
        'blocking',
        `horizontal overflow of ${checks.overflowPx}px`,
        checks.offenders,
      );
    if (checks.interpolation.length)
      add(
        'interpolation',
        'blocking',
        `unrendered template interpolation: ${checks.interpolation.join(' | ')}`,
      );
    if (checks.cls > 0.25)
      add('layout-shift', 'blocking', `cumulative layout shift ${checks.cls.toFixed(3)} (> 0.25)`);
    else if (checks.cls > 0.1)
      add('layout-shift', 'warning', `cumulative layout shift ${checks.cls.toFixed(3)} (> 0.1)`);

    const mask = [...(config.mask ?? []), ...(screen.mask ?? []), ...(state.mask ?? [])].map((s) =>
      page.locator(s),
    );
    await page.screenshot({
      path: file,
      fullPage: state.fullPage ?? true,
      animations: 'disabled',
      caret: 'hide',
      mask,
    });
  } catch (err) {
    const msg = String(err?.message ?? err).split('\n')[0];
    add(/Timeout/i.test(msg) ? 'wait-timeout' : 'navigation-error', 'blocking', msg.slice(0, 300));
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
  return result;
}

function writeReports(results) {
  const blocking = results.flatMap((r) =>
    r.findings.filter((f) => f.severity === 'blocking').map((f) => ({ ...f, capture: r.file })),
  );
  const warnings = results.reduce(
    (n, r) => n + r.findings.filter((f) => f.severity === 'warning').length,
    0,
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    base,
    screensFile: rel(path.resolve(args.screens)),
    matrix: { viewports, themes },
    captures: results.length,
    blocking: blocking.length,
    warnings,
    results,
  };
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);

  const lines = [
    '# Visual capture report',
    '',
    `- Base: ${base}`,
    `- Matrix: ${viewports.join(', ')} x ${themes.join(', ')}`,
    `- Captures: ${results.length}; blocking findings: ${blocking.length}; warnings: ${warnings}`,
    '',
    '| Screen | State | Viewport | Theme | Blocking | Warnings | Screenshot |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((r) => {
      const b = r.findings.filter((f) => f.severity === 'blocking').length;
      return `| ${r.id} | ${r.state} | ${r.viewport} | ${r.theme} | ${b} | ${r.findings.length - b} | screens/${path.basename(r.file)} |`;
    }),
    '',
    '## Blocking findings',
    '',
    ...(blocking.length
      ? blocking.map((f) => `- \`${path.basename(f.capture)}\` **${f.type}**: ${f.message}`)
      : ['None.']),
    '',
  ];
  writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
  return summary;
}

try {
  ensureDir(path.join(outDir, 'screens'));
  const browser = await launchChromium();
  let results;
  try {
    results = await pool(jobs, Number(args.workers ?? 3), (job) => runJob(browser, job));
  } finally {
    await browser.close();
  }
  const summary = writeReports(results);
  if (!args.quiet) {
    console.log(
      `capture: ${summary.captures} captures, ${summary.blocking} blocking, ${summary.warnings} warnings -> ${rel(path.join(outDir, 'report.md'))}`,
    );
  }
  process.exit(summary.blocking ? 1 : 0);
} catch (err) {
  console.error(
    err instanceof ToolMissing ? `capture: ${err.message}` : `capture: ${err?.stack ?? err}`,
  );
  process.exit(2);
}
