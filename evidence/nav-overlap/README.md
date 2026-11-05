# Navigation overlap fix (`fix/nav-overlap`)

Reported: "nav menu items are overlapping" on Budget hierarchy at about 1024px wide: the expanded navigation covers the page and the account row ("Ananya Iyer") sits on top of the last menu group.

## Root cause

- Satori's `sat-platform-nav` puts projected menus in a list that is `overflow-y: hidden` and only scrolls while the mouse hovers it. The list is clipped flush against `sat-platform-nav-user`, so a half-cut item ends exactly where the account row starts and looks covered by it. Touch, keyboard-less wheel and short windows could not reach the items below (for the CEO, "Audit log" sat 124–456px below the top of the account row).
- Satori 1.0.0-alpha.171 has no docked or pinned mode: when expanded, `sat-platform-nav-container` always renders a scrim, disables pointer events on the main content and offsets the content only by the 56px rail (0 at 675px and below). The shell closed it on navigation and the scrim closed it on click, but Escape did nothing and picking the page already open left it open.

## Fix (shell only: `libs/web/shell/src/lib/shell.{html,ts,scss}`)

- The brand card and menus sit in `bf-shell__nav`, which fills Satori's list area and scrolls on its own (wheel, touch, keyboard), ends with 8px padding and a divider above the account row, and mirrors Satori's 4px hover scrollbar so items never shift.
- The expanded navigation stays Satori's modal overlay (the only supported mode) and now closes on Escape (an open menu takes Escape first), on the scrim, when a page is picked (including the one already open) and on any navigation. The default is the collapsed rail, which never covers content.
- `nav.ts` (menu content) is untouched.

## Outcomes (`before-after/measurements--*.json`, script run on the local stack)

| Viewport (role)                           | Menu scrolls without hover | Last item clickable | Gap last item → account row | Escape     | Click on scrim | Overlap with content when closed |
| ----------------------------------------- | -------------------------- | ------------------- | --------------------------- | ---------- | -------------- | -------------------------------- |
| 1024x768 (regional manager), before       | no                         | no                  | −288px (hidden behind)      | stays open | closes         | 0                                |
| 1024x768 (regional manager), after        | yes                        | yes                 | 11px                        | closes     | closes         | 0                                |
| 1024x600 (regional manager), before       | no                         | no                  | −456px                      | stays open | closes         | 0                                |
| 1024x600 (regional manager), after        | yes                        | yes                 | 11px                        | closes     | closes         | 0                                |
| 1440x900 (regional manager / CEO), before | no                         | no                  | −156 / −336px               | stays open | closes         | 0                                |
| 1440x900 (regional manager / CEO), after  | yes                        | yes                 | 11px                        | closes     | closes         | 0                                |
| 834x1112 tablet (CEO), before             | no                         | no                  | −124px                      | stays open | closes         | 0                                |
| 834x1112 tablet (CEO), after              | yes                        | yes                 | 11px                        | closes     | closes         | 0                                |
| 412x915 mobile (CEO), before              | no                         | no                  | −321px                      | stays open | closes         | 0                                |
| 412x915 mobile (CEO), after               | yes                        | yes                 | 11px                        | closes     | closes         | 0                                |

## Journey

`apps/web-e2e/src/shell/nav-overlay.spec.ts` (finance admin, the longest menu; desktop at 1024x768 and 1440x900, tablet, mobile):

- the expanded navigation closes on Escape (after an open account menu), on the scrim (without activating the page), on picking the open page and on picking another page; afterwards the content's leading edge takes clicks;
- a touch swipe (no hover) reaches "Rules and policies" fully above the account row, and tapping it opens the page.

Against the old shell build all 6 runs failed (Escape left the navigation open; the swipe left the last item at viewport ratio 0). Against the fix: 6/6 pass; all shell journeys 100/100.

## Visual QA and baselines

`visual-qa/report.md` (no blocking findings), `visual-qa/exploratory.md`. Baselines for `000a-app-shell` regenerated in the pinned image (`npm run e2e:update-snapshots -- --update-snapshots=all -g 000a-app-shell`, 19 files): the rail divider on desktop and tablet and the scrollable drawer.

## Gates

`gate-summary.txt` (`scripts/gate.sh`, all modes).

## Open points

- The UX spec (`docs/ux/screens/000a-app-shell.md`, Responsive) asks for a docked 240px sidebar on desktop. Satori's platform navigation cannot dock; doing it in the app means overriding `.sat-platform-nav-*` internals, which `no-ds-internals-overrides` forbids. Needs a Satori feature or an approved exception.
- Pre-existing: the rail does not highlight the active item on URLs with query parameters (menu items match exactly).
