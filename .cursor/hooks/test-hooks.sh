#!/bin/sh
# Runs the hook test suite (sample JSON payloads through every hook). No dependencies beyond Node and git.
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec sh "$here/node.sh" "$here/test-hooks.mjs" "$@" </dev/null
