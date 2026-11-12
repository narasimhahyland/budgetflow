# Iteration 3 inspection (24 captures, 0 automated blocking)

Every screenshot opened. All iteration 1 findings are fixed: cell padding on the rules tables,
"sales tax" wording, captions on one line, tax codes not wrapping, the calculator defaulting to the
first entity, the thresholds table scrolling inside its card on tablet (stacked on phones),
padding on the template note, and readable benefit types.

Budget-safety checks: recoverable vs non-recoverable tax have their own lines; "Uses budget" is in
transaction currency with the reporting currency at the locked plan rate shown beside it, never
summed. Under / Approaching / Over use neutral, warning and important tags with icon and words. Over
shows the reportable amount and "whole amount". Company caps show "–" (never reportable). Forbidden
states use the shared 403 page.

| Screen | State   | Viewport | Severity             | Finding                                                                                |
| ------ | ------- | -------- | -------------------- | -------------------------------------------------------------------------------------- |
| 080h   | default | mobile   | minor (not blocking) | In the stacked card the Limit value splits "USD 300.00" from "per head" across the row |

No blocking findings.
