# Product overview page for leadership: verification

- Page: `design/preview/overview/index.html`, published with the clickable design preview at https://narasimhahyland.github.io/budgetflow/overview/
- Audience: company leadership. Plain business language, present tense, describing the finished product; no technical details.
- Checked locally with Playwright 1.64.1 (Chromium) on the built site (`node design/preview/build.mjs`, then `dist/overview/index.html`). The `local-*.png` screenshots show the current page (revision 2).

## Local checks

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

## Revisions

1. [#30](https://github.com/narasimhahyland/budgetflow/pull/30) (superseded): white hero with a filled primary "See the screen designs" button. Reverted at the user's request because they preferred the original layout.
2. Current: the page exactly as first merged in [#28](https://github.com/narasimhahyland/budgetflow/pull/28) (identical to `c0a105c`), with one change. The "See the screen designs" link moves from the footer into the purple hero, under the positioning text, as a white button with primary-coloured text (`#322f86` on white, about 11:1 contrast). The footer instance is removed, so the link appears once.

| Check (revision 2, local, 2026-11-05)                                                                                      | Expected                                                         | Result |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| Diff against `c0a105c`                                                                                                     | Only the button styles, the hero link and the footer removal     | pass   |
| Button at laptop, tablet and phone widths                                                                                  | White background, `rgb(50, 47, 134)` text, in the first viewport | pass   |
| States ([rest](local-hero-link-rest.png), [hover](local-hero-link-hover.png), [keyboard focus](local-hero-link-focus.png)) | Hover turns light lavender; focus shows a white ring             | pass   |
| Links to the screen designs on the page                                                                                    | Exactly one, in the hero                                         | pass   |
| Click the button                                                                                                           | Opens the preview index (`../index.html`)                        | pass   |
| Print view                                                                                                                 | Button hidden, no links in the footer                            | pass   |
| No horizontal overflow                                                                                                     | At 1440 px, 900 px and phone width                               | pass   |

## Live checks (after each deploy)

### First publish

- Merged in [#28](https://github.com/narasimhahyland/budgetflow/pull/28) (merge commit `ba9a1f0`) and published with `design/preview/deploy.sh`. Checked 2026-11-05 02:32 UTC.

| Check                                                                                 | Expected                                                | Result |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| `curl -sI` on the live URL                                                            | HTTP 200, `text/html`                                   | pass   |
| Live index "Product overview" link ([live-preview-index.png](live-preview-index.png)) | Opens `/budgetflow/overview/`, title "Product overview" | pass   |
| Live page at 1440 px and on a phone                                                   | 5 sections, 8 steps, 11 feature pillars, 9 roles        | pass   |
| Console and page errors                                                               | None                                                    | pass   |

### Revision 1 (superseded)

- Merged in [#30](https://github.com/narasimhahyland/budgetflow/pull/30) (merge commit `a7b8b26`), checked live 2026-11-05 02:54 UTC: HTTP 200, filled primary button in a white hero, no footer links, no page errors. Its screenshots were replaced by the revision 2 check below.

### Revision 2

- Merged in [#33](https://github.com/narasimhahyland/budgetflow/pull/33) (merge commit `3acc082`), then published with `design/preview/deploy.sh` from that commit.
- Checked: 2026-11-05 03:15 UTC, curl and Playwright 1.64.1 (Chromium) against https://narasimhahyland.github.io/budgetflow/overview/

| Check                                                                                                                                | Expected                                                                                               | Result |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------ |
| `curl -sI` on the live URL ([live-curl-headers.txt](live-curl-headers.txt))                                                          | HTTP 200, `text/html`, new file (31604 bytes)                                                          | pass   |
| Laptop, 1440 px ([live-desktop-1440-hero.png](live-desktop-1440-hero.png), full page [live-desktop-1440.png](live-desktop-1440.png)) | Purple hero (`rgb(86, 84, 172)`) with a white "See the screen designs" button, `rgb(50, 47, 134)` text | pass   |
| Phone, iPhone 13 ([live-mobile-390-hero.png](live-mobile-390-hero.png), full page [live-mobile-390.png](live-mobile-390.png))        | Button in the first viewport, no horizontal overflow                                                   | pass   |
| Links to the screen designs                                                                                                          | Exactly one, in the hero; none in the footer                                                           | pass   |
| Click the button                                                                                                                     | Opens `/budgetflow/index.html` (clickable design preview)                                              | pass   |
| Page errors                                                                                                                          | None                                                                                                   | pass   |
