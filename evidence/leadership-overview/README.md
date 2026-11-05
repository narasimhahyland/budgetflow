# Product overview page for leadership: verification

- Page: `design/preview/overview/index.html`, published with the clickable design preview at https://narasimhahyland.github.io/budgetflow/overview/
- Audience: company leadership. Plain business language, present tense, describing the finished product; no technical details.
- Checked locally: 2026-11-05, Playwright 1.64.1 (Chromium) on the built site (`node design/preview/build.mjs`, then `dist/overview/index.html`).

## Local checks (before merge)

| Check                                                                                                           | Expected                                                     | Result |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Build copies the page to `dist/overview/index.html`                                                             | File present after `node design/preview/build.mjs`           | pass   |
| Laptop, 1440 px wide ([local-desktop-1440.png](local-desktop-1440.png))                                         | All sections render, no horizontal overflow                  | pass   |
| Tablet, 900 px wide ([local-tablet-900.png](local-tablet-900.png))                                              | Grids reflow, no empty tinted cells, no horizontal overflow  | pass   |
| Phone, iPhone 13 ([local-mobile-390.png](local-mobile-390.png))                                                 | Single column, readable type, no horizontal overflow         | pass   |
| Print stylesheet ([local-print-view.png](local-print-view.png)); A4 PDF 8 pages                                 | White background, dark text, section nav hidden, cards whole | pass   |
| Preview index shows a "Product overview" link ([local-preview-index-link.png](local-preview-index-link.png))    | Link next to "Start the guided flow", opens `overview/`      | pass   |
| Self-contained                                                                                                  | Inline CSS only; no scripts, external fonts or images        | pass   |
| Public-content scan (internal tool names, figures, people, office cities, "prototype", emojis, technical terms) | No matches; only generic system categories                   | pass   |

## Revision: "See the screen designs" is the primary action in the hero

The button moved from the footer to the hero, under the positioning text, as a filled primary button (`#5654ac`, white text). The hero body is now white, with a slim purple brand bar above it, so the button stands out; the footer keeps only its closing line. The `local-*.png` screenshots above show the revised page.

| Check (local, 2026-11-05)                       | Expected                                                         | Result |
| ----------------------------------------------- | ---------------------------------------------------------------- | ------ |
| Button style at laptop, tablet and phone widths | Background `rgb(86, 84, 172)`, white text, in the first viewport | pass   |
| Phone (iPhone 13)                               | Full-width button, no horizontal overflow                        | pass   |
| Click the button                                | Opens the preview index (`../index.html`)                        | pass   |
| Print view                                      | Button hidden, no links left in the footer                       | pass   |

## Live check (after deploy)

- Merged in [#28](https://github.com/narasimhahyland/budgetflow/pull/28) (merge commit `ba9a1f0`), then published with `design/preview/deploy.sh` from that commit.
- Checked: 2026-11-05 02:32 UTC, curl and Playwright 1.64.1 (Chromium) against https://narasimhahyland.github.io/budgetflow/overview/

| Check                                                                                 | Expected                                                | Result |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| `curl -sI` on the live URL ([live-curl-headers.txt](live-curl-headers.txt))           | HTTP 200, `text/html`                                   | pass   |
| Live index "Product overview" link ([live-preview-index.png](live-preview-index.png)) | Opens `/budgetflow/overview/`, title "Product overview" | pass   |
| Live page at 1440 px ([live-desktop-1440.png](live-desktop-1440.png))                 | 5 sections, 8 steps, 11 feature pillars, 9 roles        | pass   |
| Live page on a phone ([live-mobile-390.png](live-mobile-390.png))                     | HTTP 200, no horizontal overflow                        | pass   |
| Console and page errors                                                               | None                                                    | pass   |

The full-page `live-desktop-1440.png` and `live-mobile-390.png` were replaced by the revision check below.

### Live check of the hero button revision

- Merged in [#30](https://github.com/narasimhahyland/budgetflow/pull/30) (merge commit `a7b8b26`), then published with `design/preview/deploy.sh` from that commit.
- Checked: 2026-11-05 02:54 UTC, curl and Playwright 1.64.1 (Chromium) against https://narasimhahyland.github.io/budgetflow/overview/

| Check                                                                                                                                | Expected                                                       | Result |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------ |
| `curl -sI` on the live URL ([live-curl-headers.txt](live-curl-headers.txt))                                                          | HTTP 200, `text/html`, new file (31630 bytes)                  | pass   |
| Laptop, 1440 px ([live-desktop-1440-hero.png](live-desktop-1440-hero.png), full page [live-desktop-1440.png](live-desktop-1440.png)) | "See the screen designs" filled `#5654ac`, white text, in hero | pass   |
| Phone, iPhone 13 ([live-mobile-390-hero.png](live-mobile-390-hero.png), full page [live-mobile-390.png](live-mobile-390.png))        | Full-width button in the first viewport, no overflow           | pass   |
| Click the button                                                                                                                     | Opens `/budgetflow/index.html` (clickable design preview)      | pass   |
| Footer                                                                                                                               | No links left                                                  | pass   |
| Page errors                                                                                                                          | None                                                           | pass   |
