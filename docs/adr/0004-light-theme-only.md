# 0004 Light theme only (dark theme deferred)

## Context

Satori supports light and dark through `light-dark()` tokens. The product owner decided that a dark theme is not required for now.

## Decision

- `apps/web/src/styles.scss` sets `color-scheme: light` with `@include sat.theme`; there is no theme toggle.
- Visual checks capture the light theme only: `scripts/visual/*` default to `--themes light`, the web-e2e config has only the `visual-light` project, and the npm visual scripts and CI visual step run light only.
- Styles keep using `--mat-sys-*` / `--sat-sys-*` tokens, so enabling dark later is a `color-scheme` and capture-matrix change, not a restyle.

## Consequences

- Re-enabling dark: change `color-scheme`, add the `visual-dark` project and scripts, and run captures with `--themes light,dark` (or `BF_VISUAL_THEMES=light,dark`), then create dark baselines with a reason in the PR.
