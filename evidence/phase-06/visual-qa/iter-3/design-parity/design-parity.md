# Design parity (advisory)

Approved designs: `design/stitch`. Pixel threshold 0.1; rows above 15% mismatch or with a different aspect ratio are marked to inspect closely. The ratio never decides parity on its own: open each side-by-side image and judge layout, hierarchy, component choice, copy and the budget-safety visual rules.

| Screen                 | State   | Viewport | Theme | Mismatch | Inspect closely | Side by side                                                     |
| ---------------------- | ------- | -------- | ----- | -------- | --------------- | ---------------------------------------------------------------- |
| 080a-actuals-import    | default | desktop  | light | 31.15%   | yes             | 080a-actuals-import--default--desktop--light.side-by-side.png    |
| 080b-unmatched-actuals | default | desktop  | light | 21.63%   | yes             | 080b-unmatched-actuals--default--desktop--light.side-by-side.png |
| 080c-gl-tie-out        | default | desktop  | light | 25.04%   | yes             | 080c-gl-tie-out--default--desktop--light.side-by-side.png        |

Designs without a matching capture: none.
Captured screens without an approved design: 053-event-reconciliation, 054-close-event, 080a-mapping-rules, 080a-matched-actuals, 080d-accruals-prepaids, 085a-commitment-hygiene.
