#!/usr/bin/env bash
# Runs the BudgetFlow gates with one command and prints a summary.
#
# Usage: scripts/gate.sh [mode ...] [--affected] [--fail-fast] [--no-cache] [--evidence <dir>]
#   lint            ESLint, stylelint (satori-lint), Satori design system check (sdsc)
#   typecheck       TypeScript across projects
#   build           builds, OpenAPI drift check, Drizzle migration check
#   functional-api  API scenario tests over HTTP against the running stack (apps/api-e2e)
#   functional-e2e  Playwright user journeys against the running stack (apps/web-e2e)
#   visual          visual regression baselines in the pinned Playwright image
#   static = lint typecheck build; functional = functional-api functional-e2e; all = every mode (default)
# A secret scan always runs first. Functional and visual modes start the local stack with the deterministic
# seed (scripts/stack.sh up && reset) once. Steps whose Nx target no project defines yet are reported as SKIP.
# Logs: tmp/gate/<timestamp>/<step>.log. Exit code 1 if any step failed.
set -uo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))
cd "$root" || exit 2
# shellcheck source=scripts/lib/node-env.sh
. "$root/scripts/lib/node-env.sh"
[ "${CI:-}" = "true" ] || bf_use_node24

modes=()
fail_fast=0
affected=0
nx_flags=()
evidence=""
while [ $# -gt 0 ]; do
  case "$1" in
    lint|typecheck|build|functional-api|functional-e2e|visual) modes+=("$1") ;;
    static) modes+=(lint typecheck build) ;;
    functional) modes+=(functional-api functional-e2e) ;;
    all) modes+=(lint typecheck build functional-api functional-e2e visual) ;;
    --affected) affected=1 ;;
    --fail-fast) fail_fast=1 ;;
    --no-cache) nx_flags+=(--skip-nx-cache) ;;
    --evidence) evidence=${2:?--evidence needs a directory}; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "gate: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done
[ "${#modes[@]}" -eq 0 ] && modes=(lint typecheck build functional-api functional-e2e visual)
want() { case " ${modes[*]} " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

stamp=$(date +%Y%m%d-%H%M%S)
log_dir="tmp/gate/$stamp"
mkdir -p "$log_dir"
summary="$log_dir/summary.txt"
: >"$summary"
failed=0

finish() {
  echo
  echo "Gate summary (${modes[*]}) — logs in $log_dir"
  while IFS='|' read -r status name detail; do
    case "$status" in
      FAIL) printf '  %-4s %-15s %6s  %s\n' "$status" "$name" "$detail" "$log_dir/$name.log" ;;
      SKIP) printf '  %-4s %-15s  %s\n' "$status" "$name" "$detail" ;;
      *) printf '  %-4s %-15s %6s\n' "$status" "$name" "$detail" ;;
    esac
  done <"$summary"
  if [ -n "$evidence" ]; then
    mkdir -p "$evidence"
    {
      echo "scripts/gate.sh ${modes[*]} — $(date -u +%Y-%m-%dT%H:%M:%SZ) — commit $(git rev-parse --short HEAD 2>/dev/null || echo none)"
      cat "$summary"
      echo "Reports: dist/.playwright/apps/api-e2e/report, dist/.playwright/apps/web-e2e/report"
    } >"$evidence/gate-summary.txt"
    echo "Evidence: $evidence/gate-summary.txt"
  fi
  exit "$failed"
}

skip() { printf 'SKIP|%s|%s\n' "$1" "$2" >>"$summary"; echo "  - $1 skipped: $2"; }
fail() { printf 'FAIL|%s|%s\n' "$1" "$2" >>"$summary"; failed=1; echo "  ✗ $1: $2"; [ "$fail_fast" = 1 ] && finish; }

step() {
  local name=$1
  shift
  local start end status
  printf '\n▶ %-15s %s\n' "$name" "$*"
  start=$(date +%s)
  if "$@" >"$log_dir/$name.log" 2>&1; then status=PASS; else status=FAIL; fi
  end=$(date +%s)
  printf '%s|%s|%ss\n' "$status" "$name" "$((end - start))" >>"$summary"
  if [ "$status" = FAIL ]; then
    failed=1
    echo "  ✗ $name failed — last 40 lines of $log_dir/$name.log:"
    tail -n 40 "$log_dir/$name.log" | sed 's/^/    /'
    [ "$fail_fast" = 1 ] && finish
  else
    echo "  ✓ $name ($((end - start))s)"
  fi
}

step secrets sh scripts/secret-scan.sh --all --quiet

if [ ! -f nx.json ] || [ ! -d node_modules ]; then
  if [ -f nx.json ]; then
    reason="node_modules missing: run npm ci (needs the @hylandsoftware registry token)"
    failed=1
  else
    reason="Nx workspace not scaffolded yet"
  fi
  for m in "${modes[@]}"; do skip "$m" "$reason"; done
  finish
fi

# bash 3.2 (macOS /bin/bash) treats an empty "${arr[@]}" as unbound under set -u.
# shellcheck disable=SC2329  # invoked through step "$@"
nx_run() { npx nx "$@" ${nx_flags[@]+"${nx_flags[@]}"}; }

graph="$root/$log_dir/graph.json"
npx nx graph --file="$graph" >/dev/null 2>&1 || rm -f "$graph"
has_target() {
  if [ -f "$graph" ]; then
    node -e 'const g = require(process.argv[1]).graph;
      process.exit(Object.values(g.nodes).some((n) => n.data?.targets?.[process.argv[2]]) ? 0 : 1);' "$graph" "$1"
  else
    [ -n "$(npx nx show projects --with-target "$1" 2>/dev/null)" ]
  fi
}
affected_base() {
  git rev-parse --verify -q HEAD >/dev/null || return 1
  git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null
}
run_target() {
  local name=$1 target=$2 base
  if ! has_target "$target"; then skip "$name" "no project defines '$target' yet"; return; fi
  if [ "$affected" = 1 ] && base=$(affected_base) && [ -n "$base" ]; then
    step "$name" nx_run affected -t "$target" --base="$base"
  else
    step "$name" nx_run run-many -t "$target"
  fi
}

stack_ready=""
ensure_stack() {
  if [ -n "$stack_ready" ]; then [ "$stack_ready" = yes ]; return; fi
  if [ ! -f infra/compose.yaml ]; then stack_ready=missing; return 1; fi
  if ! docker info >/dev/null 2>&1; then
    stack_ready=no
    fail stack "Docker is not running; functional checks need the local stack"
    return 1
  fi
  step stack bash -c 'bash scripts/stack.sh up && bash scripts/stack.sh reset'
  if grep -q '^PASS|stack|' "$summary"; then stack_ready=yes; else stack_ready=no; return 1; fi
}

if want lint; then
  run_target lint lint
  if ls .stylelintrc* >/dev/null 2>&1 && [ -x node_modules/.bin/stylelint ]; then
    step styles npx stylelint "{apps,libs}/**/*.scss" --allow-empty-input
  else
    skip styles "no stylelint config yet"
  fi
  if [ -f apps/web/project.json ]; then step satori npx sdsc check all; else skip satori "apps/web not scaffolded yet"; fi
fi
want typecheck && run_target typecheck typecheck
if want build; then
  run_target build build
  run_target openapi openapi-check
  run_target db db-check
fi

for m in functional-api functional-e2e visual; do
  want "$m" || continue
  if ! ensure_stack; then
    if [ "$stack_ready" = missing ]; then skip "$m" "infra/compose.yaml not created yet"; else skip "$m" "local stack unavailable"; fi
    continue
  fi
  case "$m" in
    functional-api|functional-e2e) run_target "$m" "$m" ;;
    visual)
      if [ -f apps/web-e2e/visual/screens.json ]; then step visual npm run e2e:visual; else skip visual "apps/web-e2e/visual/screens.json not created yet"; fi
      ;;
  esac
done
[ "$stack_ready" = yes ] && echo "  note: the local stack is still running (scripts/stack.sh down to stop it)"
finish
