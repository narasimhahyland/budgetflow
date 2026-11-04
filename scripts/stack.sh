#!/usr/bin/env bash
# Drives the local Docker Compose stack for this checkout.
#
#   scripts/stack.sh up        start and wait until every service is healthy
#   scripts/stack.sh down      stop (keeps volumes)
#   scripts/stack.sh reset     drop THIS checkout's volumes, start again, reseed
#   scripts/stack.sh seed      load the fictional seed data (idempotent)
#   scripts/stack.sh status    service status
#   scripts/stack.sh logs [service...]
#   scripts/stack.sh urls      print local URLs
#
# The compose project name derives from the checkout folder (override with COMPOSE_PROJECT_NAME),
# so worktrees get separate containers and volumes. Ports come from BF_*_PORT env vars (see .env).
set -euo pipefail

die() { echo "stack: $*" >&2; exit 1; }

root=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$root"

compose_file=${BF_COMPOSE_FILE:-infra/compose.yaml}
default_project=$(basename "$root" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | sed 's/-*$//')
project=${COMPOSE_PROJECT_NAME:-bf-$default_project}
env_args=()
[ -f .env ] && env_args=(--env-file .env)

cmd=${1:-status}
shift || true

if [ "$cmd" = urls ]; then
  echo "web       http://localhost:${BF_WEB_PORT:-4200}"
  echo "api       http://localhost:${BF_API_PORT:-3000}  (health: /health/ready)"
  echo "keycloak  http://localhost:${BF_KEYCLOAK_PORT:-8080}"
  echo "mailpit   http://localhost:${BF_MAILPIT_PORT:-8025}"
  echo "minio     http://localhost:${BF_MINIO_PORT:-9000}"
  exit 0
fi

[ -f "$compose_file" ] || die "$compose_file does not exist yet (see docs/ai-harness/agents-md/infra/AGENTS.md)"
docker info >/dev/null 2>&1 || die "Docker is not running"

dc() { docker compose -p "$project" -f "$compose_file" ${env_args[@]+"${env_args[@]}"} "$@"; }
seed() { eval "${BF_SEED_CMD:-npx nx run api:seed}"; }

case "$cmd" in
  up) dc up -d --wait ;;
  down) dc down --remove-orphans ;;
  reset)
    echo "stack: resetting project '$project' (its volumes only)"
    dc down --volumes --remove-orphans
    dc up -d --wait
    seed
    ;;
  seed) seed ;;
  status) dc ps ;;
  logs) dc logs --tail=200 "$@" ;;
  *) die "unknown command '$cmd' (up, down, reset, seed, status, logs, urls)" ;;
esac
