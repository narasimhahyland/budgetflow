#!/bin/sh
# Copies the area guides in docs/ai-harness/agents-md/<path>/AGENTS.md next to projects that exist.
# Existing AGENTS.md files are kept (they may have evolved); --force overwrites them.
# --check exits 1 when a project folder exists without its AGENTS.md (used by validate-harness).
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
src="$root/docs/ai-harness/agents-md"
force=0
check=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --check) check=1 ;;
    *) echo "usage: scripts/install-agents-md.sh [--force|--check]" >&2; exit 2 ;;
  esac
done

missing=0
for tpl in $(cd "$src" && find . -name AGENTS.md | sed 's|^\./||' | sort); do
  dir=$(dirname "$tpl")
  target="$root/$tpl"
  [ -d "$root/$dir" ] || continue
  if [ -f "$target" ] && [ "$force" = 0 ]; then
    continue
  fi
  if [ "$check" = 1 ]; then
    echo "missing: $tpl"
    missing=$((missing + 1))
  else
    cp "$src/$tpl" "$target"
    echo "installed: $tpl"
  fi
done

[ "$check" = 1 ] && [ "$missing" -gt 0 ] && exit 1
exit 0
