// Reports how much of its allowance each visual baseline is already using. Used only by
// `npm run visual:headroom`, which runs the visual project with the allowance set to zero so that
// Playwright measures every state that differs at all, not only the ones that differ too much.
//
// Why this exists: a state can sit just under `maxDiffPixelRatio` and still pass, so unrelated
// drift piles up invisibly until one small change tips it over, and whoever makes that change
// inherits a backlog they did not cause. 086-unused-expired carried a wrong breadcrumb on `main`
// through two phases that way, and the 080e desktop baselines kept a navigation rail two merges
// out of date. This report makes that visible before it fails.
//
// It never decides anything: the gate is `npm run e2e:visual`, and scripts/visual/headroom.sh
// discards this run's exit code.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { MAX_DIFF_PIXEL_RATIO } from '../support/visual-allowance';

/** States using at least this much of their allowance are called out. */
const NEAR = 0.7;
const OUT_DIR = 'tmp/visual-headroom';

type Measurement = { state: string; pixels: number; allowance: number; used: number };

/** Width and height from a PNG's IHDR, which is always the first chunk. */
function pngSize(file: string): { width: number; height: number } | null {
  const head = readFileSync(file).subarray(0, 24);
  if (head.length < 24 || head.readUInt32BE(12) !== 0x49484452) return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

export default class HeadroomReporter implements Reporter {
  private readonly measured: Measurement[] = [];
  private readonly unmeasured: string[] = [];
  private clean = 0;

  onTestEnd(test: TestCase, result: TestResult): void {
    const state = test.titlePath().slice(-2).join(' › ');
    if (result.status === 'passed') {
      this.clean += 1;
      return;
    }
    const message = result.errors.map((e) => e.message ?? '').join('\n');
    const pixels = Number(/(\d+) pixels \(ratio /.exec(message)?.[1]);
    const expected = result.attachments.find((a) => a.name === 'expected')?.path;
    const size = expected ? pngSize(expected) : null;
    if (!Number.isFinite(pixels) || !size) {
      // Not a comparison result: the state failed to reach its baseline at all (a timeout, a
      // missing baseline, a navigation error). Named in the report so it is not read as clean.
      this.unmeasured.push(state);
      return;
    }
    const allowance = size.width * size.height * MAX_DIFF_PIXEL_RATIO;
    this.measured.push({ state, pixels, allowance, used: pixels / allowance });
  }

  onEnd(): void {
    this.measured.sort((a, b) => b.used - a.used);
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    const row = (m: Measurement) =>
      `| ${m.state} | ${m.pixels} | ${Math.round(m.allowance)} | ${pct(m.used)} | ${
        m.used > 1 ? 'over the allowance, the gate fails this state' : 'inside the allowance'
      } |`;
    const near = this.measured.filter((m) => m.used >= NEAR);
    const lines = [
      '# Visual baseline headroom',
      '',
      `Allowance: ${MAX_DIFF_PIXEL_RATIO} of each image's pixels. Measured by comparing every state`,
      'with no allowance at all, so these are the differences the gate is currently tolerating.',
      '',
      `${this.clean} state(s) match their baseline exactly. ${this.measured.length} differ.`,
      '',
      `## Using ${pct(NEAR)} or more of the allowance (${near.length})`,
      '',
      near.length
        ? [
            '| State | Pixels | Allowance | Used | |',
            '| --- | --- | --- | --- | --- |',
            ...near.map(row),
          ].join('\n')
        : 'None.',
      '',
      `## Every state that differs (${this.measured.length})`,
      '',
      this.measured.length
        ? [
            '| State | Pixels | Allowance | Used | |',
            '| --- | --- | --- | --- | --- |',
            ...this.measured.map(row),
          ].join('\n')
        : 'None.',
      '',
    ];
    if (this.unmeasured.length) {
      lines.push(
        `## Not measured (${this.unmeasured.length})`,
        '',
        'These states did not reach a screenshot comparison, so they carry no reading.',
        '',
        ...this.unmeasured.map((s) => `- ${s}`),
        '',
      );
    }
    const file = resolve(OUT_DIR, 'report.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.join('\n'));

    console.log('');
    console.log(`Visual baseline headroom — ${this.clean} exact, ${this.measured.length} drifting`);
    for (const m of near)
      console.log(`  ${pct(m.used).padStart(5)} of allowance  ${m.pixels} px  ${m.state}`);
    if (!near.length) console.log(`  no state is using ${pct(NEAR)} or more of its allowance`);
    for (const s of this.unmeasured) console.log(`  not measured     ${s}`);
    console.log(`  report: ${file}`);
  }
}
