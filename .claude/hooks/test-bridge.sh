#!/bin/sh
# Runs the Claude Code bridge test suite (Claude Code payloads through every guard).
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec sh "$here/../../.cursor/hooks/node.sh" "$here/test-bridge.mjs" "$@" </dev/null
