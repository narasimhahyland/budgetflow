#!/bin/sh
# Runs a hook script with whatever Node is available. GUI-launched Cursor may not have nvm on PATH.
# No Node at all: exit 1, which Cursor treats as a failed hook and lets the action proceed (fail open).
if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/v24*/bin "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin /usr/bin; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; export PATH; break; fi
  done
fi
if ! command -v node >/dev/null 2>&1; then
  cat >/dev/null
  echo "budgetflow hook: node not found; hook skipped" >&2
  exit 1
fi
exec node "$@"
