# Gap A1 — report file exports: functional check

Stack: this worktree's Compose stack (`scripts/stack.sh up && scripts/stack.sh reset`, deterministic
seed, MinIO as the `DocumentStore`, Mailpit for email), ports 3x1xx so it runs beside the other
sessions' stacks. Roles: finance controller, finance admin, department head (owner of a scenario
subtree), location manager (scoped to Bengaluru Events), employee, auditor.

## Commands

```bash
npx playwright test -c apps/api-e2e/playwright.config.ts apps/api-e2e/src/reports/
npx playwright test -c apps/web-e2e/playwright.config.ts apps/web-e2e/src/reports/ --project=desktop --project=tablet --project=mobile
scripts/gate.sh static functional --evidence evidence/gap-a1-report-exports
```

## Outcome

| Scenario (`apps/api-e2e/src/reports/exports.spec.ts`)           | Expected                                                                                                                                                                                                                                                                                                                                          | Actual      | Result |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| CSV of a scoped run                                             | Header = the run's columns (money and percent headers name the unit); one line per run row in order; money cells = the run's minor units in major units (`1234.56`); a totals row; a budget named `=SUM(1,2) …` is written `'=SUM(1,2) …`; signed URL under `tenants/<id>/report-exports/<exportId>.csv`, expiry ≤ 5 min, body size = `sizeBytes` | As expected | pass   |
| XLSX                                                            | Stored zip with `Report` and `About` sheets; text as inline strings, no `<f>` formulas; money as number cells (`<v>2500.00</v>`); About carries scope, filters and the root id                                                                                                                                                                    | As expected | pass   |
| PDF                                                             | `%PDF-1.4` … `%%EOF`; page count ≥ rows / 50; every row label present; `page 1 of n` footer; `rowCount` = the run's total (543 rows tenant-wide in the full suite, more than the screen's 500-row page)                                                                                                                                           | As expected | pass   |
| Scope and permissions                                           | An owner's unfiltered file holds only their subtree; finance's holds more; widening to another budget is 404 `NOT_FOUND`; a company-wide report is 403 `FORBIDDEN` for the owner; another person's export is 403; an employee is 403; finance may fetch the owner's file; the owner's export list holds only their own                            | As expected | pass   |
| Audit and idempotency                                           | One `report.exported` with report, format, filters, row count, scope, file name, size and the SHA-256 of the downloaded bytes; a replay with the same key returns the same export (`Idempotent-Replayed: true`) and writes no second entry; each link handed out writes one `report.export_downloaded`                                            | As expected | pass   |
| Export recorded before files existed (seeded screen-091 export) | `fileName: null`; download is 409 `REPORT_EXPORT_NO_FILE`                                                                                                                                                                                                                                                                                         | As expected | pass   |
| Scheduled delivery                                              | Run → `partly_delivered`, 1 delivered, 1 skipped; one CSV and one XLSX export for the run (not per recipient), each with one `report.exported`; the department head's email in Mailpit carries both files, byte for byte (SHA-256) the stored exports, CSV as `text/csv`; the location manager, who cannot see the scope, receives nothing        | As expected | pass   |

| Journey (`apps/web-e2e/src/reports/reports.spec.ts`) | Expected                                                                                                                                                                      | Actual      | Result                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------ |
| Download menu saves a CSV (finance controller, 086)  | Download → CSV file starts a browser download named `unused-expired-<date>-<id>.csv` with a header and every row the API run returns; the banner names the file and row count | As expected | pass                           |
| Screen 091 copy and exports (finance admin)          | The delivery note says email carries files and chat carries figures; the seeded export offers no Download                                                                     | As expected | pass (desktop, tablet, mobile) |

Gate results: `../gate-summary.txt`. Sample files rendered from the seed: `../visual-qa/exploratory/sample-*`.

## Notes

- The first full gate run failed one check: the PDF scenario compared the export's row count with
  the screen's 500-row page. The export is right to carry every row; the scenario now compares with
  the run's `rowCount` (its total). Re-run green.
- The stack runs on real time for the API; the seeded export (screen 091) is therefore already
  expired, which is why the journey asserts "no Download" rather than a specific label.
