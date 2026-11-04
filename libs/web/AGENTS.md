# libs/web — UI libraries

- `ui`: shared presentation pieces on Satori (money and currency-triplet display, KPI card, budget-status to `sat-status-tag` mapping, impact preview, confirm-with-typed-reason dialog, charts on dataviz tokens). Presentational only: inputs in, outputs out, no API calls. Add a component only when Satori and Material have nothing suitable and two features need it.
- `data-access`: typed API access built on the `libs/contracts` client, plus signal-based state per domain. Surfaces the API's problem `code` and plain-English `detail`. Never hand-written request types.
- `features/<group>`: one lib per screen group, exporting `Routes`. Features use `ui` and `data-access`, never each other.
- Charts use only `--categorical-data-viz-*` / `--sequential-data-viz-*` and always have a text alternative.
- Copy is plain English in templates. Behavior is proven by journeys in `apps/web-e2e` (`/functional-check`), visuals by `/visual-qa`.

Use `/new-screen`. Rules: `.cursor/rules/frontend-angular.mdc`, `frontend-satori-styling.mdc`, `testing-visual.mdc`.
