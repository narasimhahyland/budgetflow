# Exploratory pass

Script: a throwaway Playwright script (`tmp/a1-explore.mjs`, not committed) signed in as the finance
admin at desktop 1440, tablet 834 and mobile 412, against this worktree's stack.

| Step                                                                                 | Result                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reports/unused-expired` → Download → CSV file, Excel workbook (XLSX), PDF document | Each starts a browser download named `unused-expired-<date>-<id>.<ext>`; the banner reads "Downloading … (11 rows)". Samples: `sample-*.csv`, `sample-*.xlsx`, `sample-*.pdf` |
| `/reports/schedules` → Recent exports → Download on a ready row                      | A browser download starts; the seeded expired export shows no Download                                                                                                        |
| Console errors                                                                       | None                                                                                                                                                                          |
| Failed requests                                                                      | Only `net::ERR_ABORTED` on each signed MinIO URL: Chromium cancels a navigation once it turns into a download. The download itself completes (the samples were saved)         |

Screenshots: `report-download-menu--*.png`, `report-download-notice--*.png`, `recent-exports--*.png`.
