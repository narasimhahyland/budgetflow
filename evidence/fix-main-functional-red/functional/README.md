# main functional job red at 1dc2c191: two API scenarios

Commands (worktree off origin/main, stack on free ports 36xxx):

- `npx playwright test -c apps/api-e2e/playwright.config.ts apps/api-e2e/src/db/migrations.spec.ts`
- `scripts/gate.sh functional --evidence tmp/gate-evidence` ([gate-summary.txt](../gate-summary.txt))

| Scenario                                                                                          | Expected                                                             | Before the fix                                                                                                | After the fix                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `discussions.spec.ts` › the author may edit for 15 minutes; after that the comment is frozen      | 409 `COMMENT_EDIT_WINDOW_EXPIRED` once the comment is 16 minutes old | the edit still succeeded (the test aged the comment from the real `now()`, after the pinned stamp)            | pass                                           |
| `migrations.spec.ts` › the previous migration, populated by the seed, upgrades to the current one | the seed loads, every row survives the upgrade                       | seed failed: `RSVPs for this event are closed.` (seed ran on the real clock, now past the seeded RSVP window) | pass (2/2 in the spec, 24.8s)                  |
| `scripts/gate.sh functional` (all API scenarios and journeys)                                     | green                                                                | red in CI run 44008665588                                                                                     | PASS: functional-api 385s, functional-e2e 373s |
