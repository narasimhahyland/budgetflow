# apps/web — Angular shell

The application shell only: providers, theme, Keycloak sign-in, platform nav, app header, tenant and org switchers, notifications, and lazy routes into `libs/web/features/*`. Screens live in feature libs; API access lives in `libs/web/data-access`.

- Bootstrap in `src/app/app.config.ts`: `provideSatori()`, `provideSatoriIcons()`, `provideSatoriIllustrations()`, `provideAndConfigureSatoriTranslations()` with English defaults (only for Satori's own strings; `@ngx-translate/core` is a Satori peer dependency), router, HTTP with the auth and tenant interceptors, OIDC (authorization code + PKCE).
- `src/styles.scss` is the only place that includes `sat.theme`. Dark mode is `color-scheme`; Satori tokens resolve through `light-dark()`.
- Feature routes are lazy (`loadChildren`) and guarded by permissions the API returns for the signed-in user and tenant (`GET /me/permissions` style). Hide what the user cannot do, and still guard the route: render `sat-403-error-state`, `sat-401-error-state` on expired sessions, never a blank page.
- The tenant (`X-Tenant-Id`) and org context come from the switchers and are sent on every API call by an interceptor; components never add headers themselves.
- Keep `sat-skip-to-content` targeting the main landmark; route changes move focus to the page heading.
- App copy is plain English in templates; no app translation files. Money, numbers and dates use Angular formatters (`en`; `en-IN` lakh/crore only for INR where the plan requires).

Verify: `npx nx build web`, then `/functional-check` (journeys in `apps/web-e2e`) and `/visual-qa` against the local stack.
