#!/usr/bin/env bash
# Reports how much of its allowance every visual baseline is already using, so drift that is still
# passing is visible before it tips a state over. Informational: this is not a gate, it cannot fail
# a build, and it always exits 0. The gate stays `npm run e2e:visual` / `scripts/gate.sh visual`.
#
#   scripts/visual/headroom.sh            every state
#   scripts/visual/headroom.sh -g 080e    one screen group
#
# Needs the local stack up with the deterministic seed, same as the visual gate, and runs in the
# pinned Playwright image so the measurement matches the one CI makes. The run itself compares with
# no allowance at all, so Playwright reports an exact pixel count for every state that differs;
# states matching their baseline exactly pass and cost nothing. Playwright therefore calls the
# drifting states failures — that is the measurement, not a verdict. Report: tmp/visual-headroom.
set -u

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root" || exit 2

export BF_E2E_VISUAL_HEADROOM=1
bash scripts/visual/pw-docker.sh npx playwright test \
  -c apps/web-e2e/playwright.config.ts \
  --project=visual-light \
  --retries=0 \
  --trace=off \
  --reporter=list,./apps/web-e2e/src/visual/headroom-reporter.ts \
  "$@"
exit 0
