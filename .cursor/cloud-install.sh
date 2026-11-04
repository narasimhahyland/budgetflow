#!/usr/bin/env bash
# Cursor Cloud agent install step (idempotent; runs on every environment build).
# Needs the SATORI_PACKAGES_TOKEN secret (Cursor dashboard > Cloud Agents > Secrets): a classic PAT
# with read:packages, SSO-authorized for the package owner org.
set -eo pipefail

if [ -z "${SATORI_PACKAGES_TOKEN:-}" ]; then
  echo "cloud-install: SATORI_PACKAGES_TOKEN is not set. Add it as a Cursor Cloud Agents secret; @hylandsoftware packages cannot install without it." >&2
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | PROFILE=/dev/null bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm alias default 24
fi

# Auth by reference only: npm expands ${SATORI_PACKAGES_TOKEN} when it runs, so the token never lands on disk
# (environment builds snapshot the disk).
npmrc="$HOME/.npmrc"
# shellcheck disable=SC2016
line='//npm.pkg.github.com/:_authToken=${SATORI_PACKAGES_TOKEN}'
grep -qxF "$line" "$npmrc" 2>/dev/null || printf '%s\n' "$line" >>"$npmrc"

if [ -f package-lock.json ]; then
  npm ci --no-audit --fund=false
  npx playwright install --with-deps chromium || npx playwright install chromium
else
  echo "cloud-install: no package-lock.json yet (Phase 1 creates the workspace); skipping npm ci"
fi
git config core.hooksPath .githooks
echo "cloud-install: done (Node $(node -v))"
