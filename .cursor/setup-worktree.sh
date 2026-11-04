#!/usr/bin/env bash
# Prepares a fresh worktree: Node 24, `npm ci` (offline cache first), a local .env with its own
# compose project name, area AGENTS.md files, and git hooks.
# Run by Cursor through .cursor/worktrees.json, and by scripts/worktree.sh new.
# Dependencies are installed, never symlinked: a shared node_modules breaks the main checkout.
set -euo pipefail

cd "${1:-$(git rev-parse --show-toplevel)}"
# shellcheck source=scripts/lib/node-env.sh
. scripts/lib/node-env.sh
bf_use_node24 --install

if [ -f package-lock.json ]; then
  echo "setup-worktree: Node $(node -v), installing dependencies in $(pwd)"
  npm ci --prefer-offline --no-audit --fund=false
fi

if [ ! -f .env ] && [ -f infra/.env.example ]; then
  cp infra/.env.example .env
  name=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-' | sed 's/-*$//')
  printf '\nCOMPOSE_PROJECT_NAME=bf-%s\n' "$name" >>.env
  echo "setup-worktree: created .env from infra/.env.example (compose project bf-$name)."
  echo "  If another stack runs on this machine, change the BF_*_PORT values in .env before scripts/stack.sh up."
fi

sh scripts/install-agents-md.sh
git config core.hooksPath .githooks
echo "setup-worktree: ready. Run scripts/gate.sh static before your first change to confirm a green baseline."
