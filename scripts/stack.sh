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

# One "now" for the whole stack. The visual suite freezes the *browser* clock to freezeTime in
# apps/web-e2e/visual/screens.json; unless the API agrees, every age, countdown and overdue flag the
# server computes drifts against a baseline that cannot move, and the state goes red on a day nobody
# changed anything (issue #86). The value is read from screens.json rather than copied into a second
# file, so the browser and the server cannot fall out of step. Override with BF_FIXED_NOW, or
# BF_FIXED_NOW=real for a stack that runs on the real clock.
screens_json=apps/web-e2e/visual/screens.json
if [ -z "${BF_FIXED_NOW:-}" ] && [ -f "$screens_json" ]; then
  BF_FIXED_NOW=$(node -e 'const t=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).freezeTime; process.stdout.write(typeof t === "string" ? t : "")' "$screens_json") ||
    die "could not read freezeTime from $screens_json (set BF_FIXED_NOW, or BF_FIXED_NOW=real)"
  [ -n "$BF_FIXED_NOW" ] || die "$screens_json has no freezeTime (set BF_FIXED_NOW, or BF_FIXED_NOW=real)"
fi
[ "${BF_FIXED_NOW:-}" = real ] && BF_FIXED_NOW=''
export BF_FIXED_NOW=${BF_FIXED_NOW:-}

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
  if [ -n "${BF_FIXED_NOW:-}" ]; then
    echo "clock     pinned to $BF_FIXED_NOW  (the API computes ages and countdowns from this)"
  else
    echo "clock     real time  (server-computed ages and countdowns will drift against baselines)"
  fi
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

# The seed's clocks. Under FIXED_NOW, everything the seed writes is stamped at that instant, so
# seeded rows carry the same times on every run and every real date:
#   - JavaScript: the seed stamps records through the application services, which read Date, so it
#     runs with a preload that reads FIXED_NOW instead, a millisecond per read
#     (scripts/lib/pinned-clock.cjs). Values the API checks against real time read its real clock.
#   - Postgres: timestamp defaults call app_now() (migration 0020), which follows app.fixed_now; the
#     seed's connections carry it as a startup option (seed_db_url).
# Only the seed is pinned. The running API and worker stay on real time for both clocks, so a record
# they create and the times they compare it with always come from one clock. Pinning the database
# for the API while its own Date stayed real put one request on two clocks: an audit entry stamped
# in JavaScript looked older than the database-stamped row it was recorded against.
seed_cmd() {
  if [ -n "${BF_SEED_CMD:-}" ]; then
    echo "$BF_SEED_CMD"
  elif [ -n "${BF_FIXED_NOW:-}" ]; then
    echo "npx nx run api:build --outputStyle=static >/dev/null && BF_PINNED_CLOCK='$BF_FIXED_NOW' node --require '$root/scripts/lib/pinned-clock.cjs' dist/apps/api/seed.js"
  else
    echo "npx nx run api:seed --outputStyle=static"
  fi
}
seed() {
  export DATABASE_URL_OWNER="postgres://${BF_PG_OWNER_USER}:${BF_PG_OWNER_PASSWORD}@127.0.0.1:${BF_PG_PORT:-5432}/${BF_PG_DB}"
  if [ -n "${BF_FIXED_NOW:-}" ]; then
    # Every session the seed opens starts with app.fixed_now, so app_now() defaults read FIXED_NOW.
    local pinned="${BF_FIXED_NOW//:/%3A}"
    DATABASE_URL_OWNER="${DATABASE_URL_OWNER}?options=-c%20app.fixed_now%3D${pinned}"
  fi
  # The worker is stopped while the seed runs, so nothing it delivers reads a half-written seed.
  # A channel delivery decides which channels it went out on from the data present at that moment:
  # slack only if the install and the person's chat link exist, push only if a subscription does.
  # The seed writes requests before it writes those channel rows, and a worker running alongside
  # delivers some requests before the channel rows land and some after, depending on how fast the
  # machine is. CI and a laptop then disagree about one row ("in-app, email" against "in-app,
  # email, slack, push") and a visual state fails on one and passes on the other. Stopped, the
  # worker finds the outbox full when it starts and every delivery reads the finished seed.
  dc stop worker >/dev/null 2>&1 || true
  eval "$(seed_cmd)"
  dc up -d --wait worker
  settle
}

# The seed command returns before the stack has finished reacting to it. Seeding writes to the
# outbox, and the worker then fans a notification out over its channels one job per channel, so a
# suite that starts too early reads a row that is still filling up — "Delivered via in-app, email"
# where a moment later it says "in-app, email, slack, push". That is one notification row taller or
# shorter, which moves everything below it.
#
# The unpublished outbox rows are counted alongside the jobs, because a quiet queue on its own
# only means the dispatcher has not got there yet. Only the queues the seed feeds are named: a
# blanket wait would never finish, as queues whose consumer lives elsewhere park jobs in `created`
# indefinitely. A job in `retry` counts as outstanding: it is work that has not landed yet. Quiet
# has to hold twice running before it counts.
settle() {
  local queues="'channel.deliver','notification.email'" waited=0 quiet=0
  local sql="select (select count(*) from outbox_messages where published_at is null)
                  + (select count(*) from pgboss.job where name in ($queues) and state in ('created','active','retry'))"
  while [ "$waited" -lt 60 ]; do
    local pending
    pending=$(dc exec -T postgres sh -lc \
      "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -At -c \"$sql\"" 2>/dev/null | tr -d '[:space:]')
    case "$pending" in '' | *[!0-9]*) return 0 ;; esac   # tables not there yet: nothing to wait for
    if [ "$pending" = 0 ]; then
      quiet=$((quiet + 1))
      [ "$quiet" -ge 2 ] && { echo "stack: seed settled after ${waited}s"; return 0; }
    else
      quiet=0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "stack: seed has not settled after ${waited}s, carrying on" >&2
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
