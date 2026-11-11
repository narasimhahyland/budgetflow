# Iteration 1 inspection

Captured with `node scripts/visual/capture.mjs --base http://localhost:34300 --only 091-scheduled-exports,086-unused-expired,082-utilization-report,080-budget-vs-actual`
(15 captures, 0 automated findings) plus the exploratory pass (`../exploratory/`).

| Screen                | State                                     | Viewport                | Severity     | Finding                                                                                                                                                          | Screenshot                                    |
| --------------------- | ----------------------------------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 086-unused-expired    | finance admin with a favourite saved view | desktop, tablet, mobile | blocking     | The saved-view favourite star renders unsized and fills the Filters card (pre-existing, only visible for a role with a favourite view, so no baseline showed it) | `../before-after/saved-view-star--before.png` |
| 091-scheduled-exports | recent exports                            | mobile                  | non-blocking | The File column (Download) is reached by scrolling the table sideways; the first column stays pinned, as every table in the app does below 600 px                | `../exploratory/recent-exports--mobile.png`   |
