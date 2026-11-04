#!/bin/sh
# Installs the pinned visual QA tool (Playwright) into tmp/visual-tools from the public npm registry.
# No private registry or token is needed, so this works before the workspace exists and in token-free CI.
# Once the workspace has @playwright/test, the scripts use node_modules instead.
# Usage: sh scripts/visual/setup-tools.sh [--with-browser] [--with-deps]
set -eu

PW_VERSION=1.64.1

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
dir="$root/tmp/visual-tools"
mkdir -p "$dir"
[ -f "$dir/package.json" ] || printf '{ "name": "visual-tools", "private": true }\n' >"$dir/package.json"

installed=$(node -p "try { require('$dir/node_modules/playwright/package.json').version } catch { '' }" 2>/dev/null || true)
if [ "$installed" != "$PW_VERSION" ]; then
  echo "setup-tools: installing playwright@$PW_VERSION into tmp/visual-tools"
  npm install --prefix "$dir" --no-audit --fund=false --loglevel=error "playwright@$PW_VERSION"
fi

with_browser=0
with_deps=""
for arg in "$@"; do
  case "$arg" in
    --with-browser) with_browser=1 ;;
    --with-deps) with_deps="--with-deps" ;;
    *) echo "setup-tools: unknown option $arg" >&2; exit 2 ;;
  esac
done
if [ "$with_browser" = 1 ]; then
  # shellcheck disable=SC2086
  "$dir/node_modules/.bin/playwright" install $with_deps chromium
fi
echo "setup-tools: ready (VISUAL_TOOLS_DIR defaults to tmp/visual-tools)"
