#!/bin/sh
# Runs a command inside the pinned Playwright image so screenshots render identically locally and in CI
# (same browser build, fonts and OS). Visual baselines are only created or compared through this script.
# Usage: scripts/visual/pw-docker.sh npx playwright test -c apps/web-e2e/playwright.config.ts --project=visual-light
# macOS: enable Docker Desktop host networking (Settings > Resources > Network) so localhost URLs, including the
# Keycloak issuer, resolve exactly as they do on the Linux CI runner.
set -eu

PW_VERSION=1.64.1
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

if [ "${PW_DOCKER:-}" = 1 ]; then exec "$@"; fi
if [ "$#" -eq 0 ]; then
  echo "usage: scripts/visual/pw-docker.sh <command...>" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "pw-docker: Docker is not available; visual baselines must come from $IMAGE" >&2
  exit 2
fi

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)

# Arguments become: [-e NAME ...] IMAGE <command...>. Variables pass by name only; docker reads the values
# from the environment, so they are never printed.
set -- "$IMAGE" "$@"
set -- -e PW_DOCKER=1 -e CI -e HOME=/tmp -e BASE_URL "$@"
# The stack's host ports too: a worktree stack on its own ports must not fall back to the defaults,
# which belong to another checkout's stack.
for name in $(env | sed -n -e 's/^\(BF_E2E_[A-Z0-9_]*\)=.*/\1/p' -e 's/^\(BF_[A-Z0-9_]*_PORT\)=.*/\1/p'); do
  set -- -e "$name" "$@"
done

exec docker run --rm --init --ipc=host --network host \
  --user "$(id -u):$(id -g)" \
  -v "$root:/work" -w /work \
  "$@"
