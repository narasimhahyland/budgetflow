# Exploratory pass (Phase 6 screens)

Driven by the Playwright journeys in `apps/web-e2e/src/accounting/` and by the capture actions, on the local stack with the seed:

- Import: "Import another file", paste CSV, column mapping auto-filled from headers, review (KPIs, rejected lines table when present), post; the notice names the period and how many lines went to the queue; "Go to unmatched queue".
- Queue: search by reference, open the drawer, FX block, choose "Charge to budget directly", pick a budget (the list pages through every visible budget), match; "Not budget-relevant" with a reason; over-tolerance lines offer "Request over-budget approval" instead of matching; split editor with two lines.
- Tie-out: entity chips switch the run; row click opens the drill-down; "Run tie-out" with an uploaded GL file on a new entity; "Add explanation"; as the finance admin, "Sign off Nov 2026 with explanations", then the signed-off banner and the locked chip. As the controller the button stays disabled with "Sign-off needs a finance admin."
- Accruals, hygiene, events: lists render for the seed; event close stays disabled while blockers exist, even with a reason and the confirmation.

Nothing broken or unreachable was found. Open UX questions are listed in the phase README.
