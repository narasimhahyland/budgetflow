# Iteration 2 inspection

Same captures after sizing the star (`.bf-view mat-icon`, 18 px). 15 captures, 0 automated findings.

| Screen                | State          | Viewport        | Severity                   | Finding                                                                                                                                                                    | Screenshot                                   |
| --------------------- | -------------- | --------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 091-scheduled-exports | recent exports | mobile          | non-blocking               | As in iteration 1: the Download column scrolls with the table                                                                                                              | `../exploratory/recent-exports--mobile.png`  |
| 091-scheduled-exports | recent exports | desktop, tablet | non-blocking (ux-reviewer) | The File header was wrapped in `bf-visually-hidden`, which this feature does not define, so it showed anyway; kept visible on purpose (plain `<th>File</th>`, same pixels) | `../exploratory/recent-exports--desktop.png` |

No blocking findings. Checked: the Download button and its menu (CSV file, Excel workbook (XLSX),
PDF document) on desktop, tablet and mobile; the success banner names the file and row count; the
091 banner says email carries files and chat carries figures; ready exports offer Download, the
seeded expired export offers none; the scoped owner (082, location manager) keeps the scope note.
