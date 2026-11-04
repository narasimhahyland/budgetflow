# infra — local stack

- `infra/compose.yaml` runs Postgres 16, Keycloak, Mailpit, MinIO, the API and the worker, each with a health check. `scripts/stack.sh` is the only supported way to drive it (it sets the compose project name per worktree).
- Host ports come from env with defaults (`${BF_PG_PORT:-5432}`, `${BF_API_PORT:-3000}`, `${BF_KEYCLOAK_PORT:-8080}`, `${BF_MAILPIT_PORT:-8025}`, `${BF_MINIO_PORT:-9000}`, `${BF_WEB_PORT:-4200}`), bound to `127.0.0.1`, so two worktrees can run stacks side by side.
- `infra/.env.example` lists every variable with dev-only placeholder values; `.env` is gitignored.
- `infra/keycloak/` holds the realm export: public SPA client (PKCE), confidential API client, roles, TOTP policy, fictional seeded users per role. Regenerate from a running instance; never hand-edit secrets in.
- Seed data is fictional (Acme Global and its legal entities), idempotent, and loaded by `scripts/stack.sh seed`.
- Pin every image version; no `latest`.

Use `/local-stack`. Rules: `.cursor/rules/infra-local-stack.mdc`.
