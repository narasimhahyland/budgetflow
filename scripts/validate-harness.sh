#!/bin/sh
# Validates the Cursor harness without installing dependencies (safe for CI without registry access).
# Usage: scripts/validate-harness.sh [--no-secret-scan]
set -u

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root" || exit 2
status=0

if ! command -v node >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/v24*/bin /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; break; fi
  done
fi

echo "▶ structure (JSON, frontmatter, links)"
node scripts/validate-harness.mjs || status=1

echo "▶ shellcheck"
if command -v shellcheck >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  shellcheck -x -S warning $(ls scripts/*.sh scripts/lib/*.sh scripts/visual/*.sh .cursor/*.sh .cursor/hooks/*.sh .claude/hooks/*.sh .githooks/* 2>/dev/null) || status=1
else
  echo "  shellcheck not installed; skipped"
fi

echo "▶ hook tests"
sh .cursor/hooks/test-hooks.sh || status=1

echo "▶ Claude Code hook bridge tests"
sh .claude/hooks/test-bridge.sh || status=1

echo "▶ visual tooling self-test (static fixtures, no app needed)"
# Skips when Playwright is not installed locally; CI sets VISUAL_SELFTEST=required after scripts/visual/setup-tools.sh.
node scripts/visual/self-test.mjs --if-available || status=1

if [ "${1:-}" != "--no-secret-scan" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "▶ secret scan (all files)"
  sh scripts/secret-scan.sh --all || status=1
fi

[ "$status" = 0 ] && echo "validate-harness: OK" || echo "validate-harness: FAILED"
exit "$status"
