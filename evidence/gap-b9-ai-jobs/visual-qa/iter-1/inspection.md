# Inspection, iteration 1

| Screen | State                           | Viewport | Severity | Finding                                                                                                                                               | Screenshot                                                              |
| ------ | ------------------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 113a   | reported-answers                | mobile   | blocking | Stacked cells with two parts ("Where", "What was wrong", review note) spread the parts across the row instead of stacking them                        | screens/113a-ai-settings-query-log--reported-answers--mobile--light.png |
| 113a   | reported-answers, review-dialog | all      | minor    | Fixed seed timestamps carried the `relative-time` mask, hiding the reported time and the reviewer line (the mask also painted over the mobile dialog) | screens/113a-ai-settings-query-log--review-dialog--mobile--light.png    |

Fixed: each multi-part cell wraps its parts in one column group; the question and answer take the full card width on mobile; the seeded timestamps are deterministic, so they no longer carry the mask.
