# Prettier ignores generated design artifacts: verification

- Branch: `chore/prettierignore-design`, rebased on `main` at `f3999d9`
- Checked: 2026-11-05, Prettier 3.6.2, Node 24
- Result: pass for the generated design artifacts. `npx prettier --check .` still fails on 50 hand-written files that were already unformatted on `main` (listed below; out of scope here).

## Ignore entries added to `.prettierignore`

```text
design/stitch/*/
design/preview/html/
design/preview/ocr/
design/preview/dist/
```

`design/stitch/README.md` and the hand-written preview source (`build.mjs`, `deploy.sh`, `links.json`, `README.md`, `assets/`) stay checked.

## Hooks

| Check                                                                                                      | Expected        | Actual                    | Result |
| ---------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- | ------ |
| Pre-commit, `main` ignore file, commit touching `design/preview/html/011-executive-dashboard/default.html` | blocked         | blocked (exit 1)          | pass   |
| Pre-commit, this branch, commit touching two preview HTML files, a Stitch `meta.json` and an OCR file      | commits         | committed (exit 0)        | pass   |
| Pre-commit, this branch, commit touching hand-written `design/preview/links.json` (unformatted then)       | blocked         | blocked (exit 1)          | pass   |
| Cursor `format` hook on an ignored HTML, `meta.json` and OCR file                                          | files untouched | no changes                | pass   |
| Cursor `format` hook on non-ignored `design/preview/links.json`                                            | file formatted  | formatted (then restored) | pass   |
| `prettier --file-info` on `design/stitch/README.md`                                                        | not ignored     | `"ignored": false`        | pass   |
| `prettier --file-info` on `design/preview/dist/index.html`                                                 | ignored         | `"ignored": true`         | pass   |

Neither hook needed a change: both run Prettier from the repository root, and Prettier 3 skips files matched by `.prettierignore` even when they are passed explicitly.

## `npx prettier --check .`

| State              | Failing files | Generated design files failing                              |
| ------------------ | ------------- | ----------------------------------------------------------- |
| `main` (`f3999d9`) | 89            | 39 (one HTML file fails to parse: `@` in an e-mail address) |
| This branch        | 50            | 0                                                           |

Still failing (hand-written, unformatted on `main`; follow-up):

- `.cursor/agents/` (2), `.cursor/hooks/` (6), `.cursor/skills/` (13), `.github/dependabot.yml`
- `design/preview/assets/frame.js`, `design/preview/assets/overlay.js`, `design/preview/build.mjs`, `design/preview/README.md`
- `docs/ai-harness/templates/` (4), `docs/ux/screens/` (13), `evidence/design-preview/README.md`
- `scripts/secret-patterns.mjs`, `scripts/secret-scan.mjs`, `scripts/visual/compare.mjs`, `scripts/visual/stitch-save.mjs`, `scripts/visual/fixtures/bad.html`, `scripts/visual/fixtures/good.html`

## Gates

`sh scripts/validate-harness.sh`: OK (hook tests, visual self-test 22/22, secret scan clean).

```text
scripts/gate.sh (all modes)
  PASS secrets             0s
  PASS lint                2s
  PASS styles              4s
  PASS satori             16s
  PASS typecheck           1s
  PASS build               1s
  PASS openapi             1s
  PASS db                  1s
  PASS stack              70s
  PASS functional-api     24s
  PASS functional-e2e     24s
  PASS visual             14s
```
