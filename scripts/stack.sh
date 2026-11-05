#!/usr/bin/env bash
# Drives the local Docker Compose stack for this checkout.
#
#   scripts/stack.sh up        build the api, worker and web bundles, start, wait until every service is healthy
#   scripts/stack.sh down      stop (keeps volumes)
#   scripts/stack.sh reset     drop THIS checkout's volumes, start again, reseed
#   scripts/stack.sh seed      load the fictional seed data (idempotent)
#   scripts/stack.sh status    service status
#   scripts/stack.sh logs [service...]
#   scripts/stack.sh urls      print local URLs
#
# The compose project name derives from the checkout folder (override with COMPOSE_PROJECT_NAME),
# so worktrees get separate containers and volumes. Ports and dev-only credentials come from .env
# when it exists, otherwise from infra/.env.example. BF_SKIP_BUILD=1 skips the host bundle build.
set -euo pipefail

die() { echo "stack: $*" >&2; exit 1; }

root=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$root"
# shellcheck source=scripts/lib/node-env.sh
. "$root/scripts/lib/node-env.sh"
[ "${CI:-}" = "true" ] || bf_use_node24

compose_file=${BF_COMPOSE_FILE:-infra/compose.yaml}
default_project=$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | sed 's/-*$//')
env_file=infra/.env.example
[ -f .env ] && env_file=.env
# Values from the env file (ports, dev-only passwords); variables already set in the shell win.
while IFS='=' read -r key value; do
  case "$key" in '' | \#*) continue ;; esac
  [ -n "${!key:-}" ] || export "$key=$value"
done <"$env_file"
project=${COMPOSE_PROJECT_NAME:-bf-$default_project}

cmd=${1:-status}
shift || true

if [ "$cmd" = urls ]; then
  echo "web       http://localhost:${BF_WEB_PORT:-4200}"
  echo "api       http://localhost:${BF_API_PORT:-3000}  (health: /health/ready, OpenAPI: /api/openapi.json)"
  echo "keycloak  http://localhost:${BF_KEYCLOAK_PORT:-8080}  (realm: budgetflow)"
  echo "mailpit   http://localhost:${BF_MAILPIT_PORT:-8025}"
  echo "minio     http://localhost:${BF_MINIO_PORT:-9000}"
  echo "mocks     http://localhost:${BF_MOCK_PROVIDERS_PORT:-4010}  (mock providers for the connectors)"
  echo "postgres  127.0.0.1:${BF_PG_PORT:-5432}  (database ${BF_PG_DB:-budgetflow})"
  exit 0
fi

[ -f "$compose_file" ] || die "$compose_file does not exist yet (see docs/ai-harness/agents-md/infra/AGENTS.md)"
docker info >/dev/null 2>&1 || die "Docker is not running"

dc() { docker compose -p "$project" -f "$compose_file" --env-file "$env_file" "$@"; }
build() {
  [ "${BF_SKIP_BUILD:-0}" = 1 ] && return 0
  echo "stack: building api, worker and web bundles"
  npx nx run-many -t build -p api worker web --outputStyle=static >/dev/null
}
up() { build && dc up -d --build --wait; }
seed() {
  export DATABASE_URL_OWNER="postgres://${BF_PG_OWNER_USER}:${BF_PG_OWNER_PASSWORD}@127.0.0.1:${BF_PG_PORT:-5432}/${BF_PG_DB}"
  eval "${BF_SEED_CMD:-npx nx run api:seed --outputStyle=static}"
}

case "$cmd" in
  up) up ;;
  down) dc down --remove-orphans ;;
  reset)
    echo "stack: resetting project '$project' (its volumes only)"
    dc down --volumes --remove-orphans
    up
    seed
    ;;
  seed) seed ;;
  status) dc ps ;;
  logs) dc logs --tail=200 "$@" ;;
  *) die "unknown command '$cmd' (up, down, reset, seed, status, logs, urls)" ;;
esac
