// The allowance every visual baseline is compared against, in one place: playwright.config.ts sets it
// on `toHaveScreenshot`, and the headroom report (`npm run visual:headroom`) divides each state's
// measured difference by it to say how much of it that state is already using.
export const MAX_DIFF_PIXEL_RATIO = 0.002;

/** `1` while a headroom run is measuring: the same states, compared with no allowance at all. */
export const MEASURING_HEADROOM = process.env.BF_E2E_VISUAL_HEADROOM === '1';
