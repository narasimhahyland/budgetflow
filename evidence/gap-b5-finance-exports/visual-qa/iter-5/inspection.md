# Iteration 5 inspection (094b), after the ux-reviewer findings

Automated: 0 blocking, 0 warnings. Every screenshot opened.

Fixed since iteration 4: empty-state padding under "New export"; Type field wide enough for
"Intercompany recharges"; the rate column reads "Reporting rate"; tax-year dates render without a UTC
shift (the lines dialog showed 5 Apr instead of 6 Apr in a +05:30 browser).

| Screen | State      | Viewport       | Severity     | Finding                                                                                                                        |
| ------ | ---------- | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 094b   | new-export | tablet, mobile | non-blocking | The lines table scrolls inside its container; totals are off-screen on mobile until scrolled (the balance banner states them). |
| 094b   | default    | mobile         | non-blocking | Not read-only on mobile (spec deviation, recorded in the spec's "As built").                                                   |
