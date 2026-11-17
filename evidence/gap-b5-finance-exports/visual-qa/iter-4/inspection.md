# Iteration 4 inspection (094b)

Automated: 0 blocking, 0 warnings. Every screenshot opened (default, new-export, forbidden x desktop, tablet, mobile).

| Screen | State      | Viewport       | Severity     | Finding                                                                                                                     |
| ------ | ---------- | -------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 094b   | new-export | tablet, mobile | non-blocking | The lines table scrolls horizontally inside its own container (fields wrap; nothing is cut off).                            |
| 094b   | default    | mobile         | non-blocking | Spec asks for a read-only list on mobile; New export stays available (the dialog works at 412 px). Recorded as a deviation. |

No blocking findings: balance check reads "Debits equal credits: USD 252.00 in 2 lines", debit and credit right-aligned with a totals row, currency codes on every amount, Create and send is `satImportantButton`, status as text tag, forbidden state for the budget owner.
