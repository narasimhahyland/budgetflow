# Market analysis (external)

Summary of the public market review done before Phase 1. It informs priorities; it is not a requirement source (the build plan is).

## Findings

- **Nobody owns the niche.** The closest products either manage event budgets only for spend booked through their own marketplace, or delegate sub-budgets only on their own cards. Spend platforms (corporate cards, travel and expense, procure-to-pay) and event platforms each cover part of the problem.
- **Budgets in spend tools mostly track rather than enforce.** Several leading spend platforms describe their budgets as plan-versus-actual tracking with alerts; enforcement lives on the card or fund, and each requires its own card or account.
- **Not found in the products reviewed (about 40):** owner-to-owner funding requests with full, partial or reject decisions (the Inter-Director Budget Contribution Request); live validation that a child allocation fits the parent's available amount at allocation time (only in one ERP, configured by finance); freeze or set to zero that blocks new requests while existing commitments complete; multi-owner co-funding of one event.

## Wedge

A card- and ERP-agnostic control layer for People Ops and location budgets: sub-delegation by non-finance owners, commitment-aware controls, co-funding with attribution, and one view across card, travel-and-expense and ERP actuals, tied out to the general ledger.

## Risks

- Fast convergence: several spend platforms shipped budget features during 2026.
- Bundling by suites already in place at buyers (card plus expense, travel plus events, HR plus spend).
- Controls stay advisory unless funds can be suspended in card platforms; card-limit push is a per-tenant option (Phase 12).
- Per-head engagement budgets are small, so expansion to field marketing, learning and offsites matters.

## Integration order (working assumption)

An open-source ERP first (open REST API, signed webhooks, hard budget checks), then the common enterprise HCM/financials, planning, card and travel-and-expense systems, then further procure-to-pay and ERP systems (Phase 12).
