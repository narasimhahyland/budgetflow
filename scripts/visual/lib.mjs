// Shared helpers for the visual QA scripts. Needs Playwright, resolved from the workspace node_modules
// or from tmp/visual-tools (scripts/visual/setup-tools.sh).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Viewports used everywhere (rules, capture, baselines). deviceScaleFactor 1 keeps comparisons stable. */
export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 834, height: 1112 }, hasTouch: true },
  mobile: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
};

export class ToolMissing extends Error {}

const searchDirs = () => [
  ...new Set(
    [process.env.VISUAL_TOOLS_DIR, ROOT, process.cwd(), path.join(ROOT, 'tmp/visual-tools')].filter(
      Boolean,
    ),
  ),
];

export function tryRequire(name) {
  for (const dir of searchDirs()) {
    try {
      return createRequire(path.join(path.resolve(dir), 'noop.js'))(name);
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  return null;
}

export function loadPlaywright() {
  const pw = tryRequire('playwright') ?? tryRequire('@playwright/test');
  if (!pw?.chromium)
    throw new ToolMissing(
      'Playwright is not installed; run: sh scripts/visual/setup-tools.sh --with-browser',
    );
  return pw;
}

export async function launchChromium() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    if (/Executable doesn't exist|browserType\.launch/i.test(String(err?.message))) {
      throw new ToolMissing(
        'Chromium for Playwright is not installed; run: sh scripts/visual/setup-tools.sh --with-browser',
      );
    }
    throw err;
  }
}

/** --key value, --key=value and boolean flags. Positional arguments go to `_`. */
export function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq > 0 ? eq : undefined);
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    if (booleans.includes(key)) out[key] = inline === undefined ? true : inline !== 'false';
    else out[key] = inline ?? argv[++i];
  }
  return out;
}

export const list = (value, fallback = []) =>
  value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

/**
 * Themes to capture: light only by default (dark theme deferred). Re-enable dark with `--themes light,dark`,
 * BF_VISUAL_THEMES=light,dark, or "themes": ["light", "dark"] in screens.json.
 */
export const DEFAULT_THEMES = ['light'];
export const themesFrom = (arg, config) =>
  list(arg ?? process.env.BF_VISUAL_THEMES, config?.themes ?? DEFAULT_THEMES);

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const exists = (p) => existsSync(p);

export const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join('/');

export function captureName({ id, state, viewport, theme }) {
  return `${id}--${state}--${viewport}--${theme}`;
}

/** Runs async jobs with a fixed concurrency and returns results in input order. */
export async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
