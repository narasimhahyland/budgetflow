# Board pack permission and Approval history icon (`fix/board-pack-permission-and-nav-icon`)

Two navigation defects, one branch. Local stack `bf-nav-perms` (web 4430, API 3230), deterministic seed.

## Fix 1 — the board pack needs its own action

`BoardPackService.assertCanBuild` asked for `report.read` at tenant scope and then refused anyone who
was not tenant-wide. `GET /api/me` evaluates permissions against the tenant resource, where an
`owned` grant counts as soon as the actor owns a budget, so `report.read` reads as true for the four
owner roles the pack refuses. The 016a sidebar entry was therefore gated on `audit.read`, the widest
permission no owner holds, which cost the analyst the shortcut the server does admit.

`report.board_pack` is new, granted only at tenant scope, to exactly the roles the endpoint admits.
The endpoint now authorizes on it in one call; the route guard keeps `report.read` so an owner who
reaches the URL still sees the 403 state the spec asks for.

### Admitted set, read off the running API (`api/board-pack-by-role.json`)

| Role                 | `GET /api/reports/board-pack` | problem code | `report.read` in `/api/me` | `report.board_pack` |
| -------------------- | ----------------------------- | ------------ | -------------------------- | ------------------- |
| `ceo`                | 200                           | –            | yes                        | yes                 |
| `finance-admin`      | 200                           | –            | yes                        | yes                 |
| `finance-controller` | 200                           | –            | yes                        | yes                 |
| `auditor`            | 200                           | –            | yes                        | yes                 |
| `analyst`            | 200                           | –            | yes                        | yes                 |
| `budget-owner`       | 403                           | `FORBIDDEN`  | yes                        | no                  |
| `department-head`    | 403                           | `FORBIDDEN`  | yes                        | no                  |
| `regional-manager`   | 403                           | `FORBIDDEN`  | yes                        | no                  |
| `location-manager`   | 403                           | `FORBIDDEN`  | yes                        | no                  |

The `report.read` column is the defect: it is true for every role the pack refuses, which is why the
entry could not be gated on it. The 403 `detail` is unchanged word for word
("The board pack is open to finance roles, the CEO and auditors."), so the refusal a user sees is
identical to before.

Behaviour-neutrality was also checked exhaustively in the rule table itself: for all 14 roles, owning
a budget and not owning one, the old gate (`report.read` at tenant scope plus the tenant-wide check)
and the new gate (`report.board_pack`) return the same answer. Nothing but the analyst's navigation
entry changed.

## Fix 2 — the Approval history icon

`icon: 'checklist'` is not in `@hylandsoftware/satori-icons` (493 names in `icon-list.json`, and
`checklist` is not among them, nor in `deprecated-icons.json`). Satori draws the icon with
`<mat-icon [svgIcon]>`, which renders nothing at all for an unknown name, so the item sat in the rail
with an empty slot. Replaced with `checklist_rtl`, which is in the set and already used twice in the
same file. Every other icon name in `nav.ts` (28 unique) was checked against the same list: all valid,
none deprecated.

`before-after/auditor-sidebar--{before,after}.png`: the gap between the two book icons (Board and FP&A
pack, Audit log) is filled and the rail is evenly spaced.
`before-after/analyst-sidebar--{before,after}.png`: the analyst gains the Board and FP&A pack entry
(11 items to 12).

## Checks

| Check                                                 | Expected                                                                                            | Result |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| `reports/board-pack.spec.ts` admitted/refused roles   | five roles 200; four owner roles plus employee, organizer and org admin 403/404 on preview and list | pass   |
| `reports/board-pack.spec.ts` `/api/me` permission set | `report.board_pack` for the five, `report.read` but not `report.board_pack` for the four owners     | pass   |
| `identity/me.spec.ts`                                 | per-role permission sets unchanged                                                                  | pass   |
| `shell/role-navigation.spec.ts`                       | exact nav per role; analyst now ends with Board and FP&A pack                                       | pass   |
| `shell/role-navigation.spec.ts` icon assertion        | every navigation item renders a glyph                                                               | pass   |
| `scripts/gate.sh` (all modes, `gate-summary.txt`)     | green                                                                                               | pass   |

The icon assertion was verified to be able to fail: putting `checklist` back and rebuilding the web
bundle fails the auditor case with `every navigation item renders its icon` naming "Approval history";
with `checklist_rtl` all 28 cases pass.

## Visual

The full `visual-light` suite ran unscoped: **556 passed, no baseline moved** (`npm run e2e:visual`,
and again inside `scripts/gate.sh`). No baseline captures a role that holds `audit.read` or
`report.board_pack` with the Insights group in view, so neither change reaches a baseline:

- `000a-app-shell` and `032a-period-phasing` use owner roles (department head, regional manager),
  whose navigation is identical before and after.
- `016a-board-pack--default--tablet` is the finance admin, whose rail is 37 items; the capture is cut
  off after about 20, well above Approval history at position 35.

Pre-existing finding, not fixed here: `016a-board-pack--forbidden-owner--tablet` and `--mobile`
predate the "Forecast and variance" entry added in #62 and are short one rail icon (16 against the 17
the app renders). The difference is about 400 pixels against a `maxDiffPixelRatio` budget of 0.002
(1854 pixels at tablet size), so it passes and `--update-snapshots` does not rewrite it. Worth
regenerating the next time that screen changes for another reason.
