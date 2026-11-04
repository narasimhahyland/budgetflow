#!/bin/sh
# Fails a pull request that changes visual baselines (**/__screenshots__/**) without a
# "Visual baselines updated: <reason>" line in its description. Run by CI on pull requests.
# Usage: BASE_SHA=<sha> PR_BODY="<description>" sh scripts/visual/check-baseline-reason.sh
set -eu

base=${BASE_SHA:-}
if [ -z "$base" ]; then
  echo "check-baseline-reason: no BASE_SHA (not a pull request); skipped"
  exit 0
fi
changed=$(git diff --name-only "$base"...HEAD | grep '__screenshots__/' || true)
if [ -z "$changed" ]; then
  echo "check-baseline-reason: no visual baseline changes"
  exit 0
fi
count=$(printf '%s\n' "$changed" | wc -l | tr -d ' ')
reason=$(printf '%s\n' "${PR_BODY:-}" | tr -d '\r' | sed -n 's/^Visual baselines updated:[[:space:]]*//p' | sed 's/<!--.*-->//g' | tr -d '[:space:]')
if [ -z "$reason" ]; then
  echo "::error title=Visual baselines changed without a reason::$count baseline file(s) changed. Regenerate them only with 'npm run e2e:update-snapshots' and add 'Visual baselines updated: <reason>' to the PR description."
  printf '%s\n' "$changed" | head -20
  exit 1
fi
echo "check-baseline-reason: $count baseline file(s) changed; reason given"
