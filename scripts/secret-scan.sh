#!/bin/sh
# Secret and public-repo hygiene scan. Thin wrapper so git hooks, CI and agents share one implementation.
# Usage: scripts/secret-scan.sh [--staged|--worktree|--all|--dir <path>|--files <f>...] [--quiet] [--no-internal]
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/v24*/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  echo "secret-scan: node not found; install Node 24 (nvm use 24)" >&2
  exit 2
fi

exec node "$here/secret-scan.mjs" "$@"
