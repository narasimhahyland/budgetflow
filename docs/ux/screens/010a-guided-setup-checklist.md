# 010a Guided setup checklist with sample data

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Setup > Guide (`/setup/guide`), the Phase 14 successor of the 010 status view; owner first-run checklist as a card on owner homes (`/home`) and in Help.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the checklist layout of 010. Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                           |
| ------------------------------------- | ----------------------------------------------------------------------- |
| company setup guide in progress       | `design/stitch/010a-guided-setup-checklist/default--desktop--light.png` |
| step guidance expanded with "Show me" | `step-guide--desktop--light.png`                                        |
| owner first-run checklist card        | `owner-checklist--desktop--light.png`                                   |
| demo deployment: load sample data     | `sample-data--desktop--light.png`                                       |
| all done                              | `done--desktop--light.png`                                              |

## Purpose

Get Hyland from an empty BudgetFlow to owners making their first allocation as quickly as possible: a guided list of the setup steps with why each matters, who does it, how long it takes and a "Show me" walkthrough, followed by a short first-run checklist for each budget owner that ends at their first allocation, plus a safe way to explore with sample data that never touches the company's real books.

## Roles

Organization Admin and Finance Admin (company guide; each sees their own steps first); CEO (read, owns "First budget" with Finance Admin); budget owners (BO, DH, RM, LM) see the owner checklist; Super Admin (read during provisioning). Employees see neither.

## Entry points

Home for Organization Admin and Finance Admin while setup is incomplete; 010 "Open the guide"; Help > Setup guide; first sign-in of a budget owner (owner card on 011 or the owner home); 103a invitation email "Get started" link.

## Content and actions

Company guide header: "Set up BudgetFlow", progress "7 of 12 done", "Owners active: 3 of 42 have made their first allocation" (link to 18b), "Explore with sample data" (outlined).

Steps (each row: number, step, owner, time estimate, status tag, action; expandable guidance):

1. Company basics (OA) - Done.
2. Legal entities (FA) - Done, IN01, US01, UK01.
3. Fiscal year and currency (FA) - Done, FY2026, plan rates locked.
4. Organization import (OA) - Done, 1,231 people.
5. Roles and people (OA) - Done.
6. HR headcount import (OA, FA) - Done, snapshot 1 Nov.
7. Program templates (FA) - Done, "Per-head engagement" chosen (020b).
8. First budget (FA or CEO) - Ready, "Create from template" (020) or "Roll forward last year" (023a); about 15 minutes.
9. Policies from templates (FA) - To do, "Start from policy templates" (071a); about 20 minutes.
10. Program branding (OA) - Optional, "Add your program name and logo" (102b).
11. Approvals where people work (IA) - Optional, "Connect Slack or Teams" (061e).
12. Invite budget owners (OA) - Locked until 8 is done ("Owners need a budget to own"), then "Invite owners" (103a).

Expanded guidance per step: why it matters in one sentence ("Per-head budgets are calculated from this snapshot; without it the per-head driver has nothing to multiply."), what you need (a file, a person), "Show me" (opens the screen with a short step-by-step guide anchored to the controls: 3-5 steps, Next, Back, Skip guide), "Skip for now" on optional steps (moves to "Skipped" with who and when).

Owner first-run checklist (card, sample Meera Iyer, India Region): "Get started with India Region", 2 of 5 done:

- Check your budget (021) - Done.
- Set alert thresholds (021 settings; defaults 50, 80, 100%) - Done.
- Allocate to a location or team (022 or 22a) - To do; marked "Main step"; "Allocate now".
- Add a co-owner or delegate (062) - Optional.
- Install the mobile app for approvals (59a) - Optional.
- Card actions: Hide (reopen from Help), "Show me" per step.

Explore with sample data:

- Production deployment: dialog "Sample data lives in the demo environment, a separate copy of BudgetFlow with a fictional Hyland story. Nothing you do there affects real budgets." with "Open the demo environment" (102c, new tab).
- Demo deployment (environment marked demo): "Load sample data" fills the empty demo with the seeded story (programs, regions, Bengaluru and Hyderabad events, requests, actuals), progress by area, then "Sample data loaded"; reset lives in 102c.

## Data and permissions

Step status is computed server-side from tenant settings, master data counts and existence checks (P2 setup status, extended in the P14 `admin.ts` contract with steps 7-12 and per-owner checklist status: thresholds set, first allocation posted, delegate added). Skips and hides are stored per step or per person. Owner activation ("first allocation made") reads the product analytics pipeline (18b). Actions open the owning screens, which enforce their own permissions; the guide only reads. "Load sample data" exists only when the deployment is configured as a demo environment; the production API has no such endpoint.

## States

| State              | Behaviour                                                                               |
| ------------------ | --------------------------------------------------------------------------------------- |
| In progress        | as above                                                                                |
| Step guide         | expanded guidance; "Show me" walkthrough over the target screen                         |
| Blocked step       | error tag and reason ("Headcount import failed: 12 row errors") with a link to fix      |
| Locked step        | neutral tag with the dependency in words                                                |
| Skipped            | neutral tag "Skipped by Taylor Brooks, 4 Nov" with Undo                                 |
| All done           | success banner "BudgetFlow is set up. 42 owners invited."; guide collapses to a summary |
| Owner card done    | success message "You've made your first allocation" then the card hides after 7 days    |
| Sample data dialog | production: link to the demo environment; demo: Load sample data with progress          |
| Loading / error    | `sat-ghost` rows; error banner with Retry                                               |

## Budget safety and audit

The guide moves no money and writes nothing except skips and hides. Sample data can only be loaded into a demo deployment, never into the company's ledger. Steps write their own audit entries in their screens; skipping an optional step is audited.

## Responsive and accessibility

Tablet: full guide; mobile: checklist read-only with links (setup is desktop work), owner card fully usable. Walkthrough steps are dialogs anchored to controls, with focus moved to the dialog and back to the control, and can be skipped at any point.

## Satori components

`sat-header-bar`, `sat-status-tag` (step status), `sat-interactive-card` (owner checklist card), `sat-banner`, `sat-ghost`, `satImportantButton` (main step action), `sat-illustration` (all done); Angular Material expansion panels, dialog, stepper-like walkthrough built on CDK overlay, snackbar.

## Related screens and navigation

010 setup completion, 005 first-time setup, 020 create budget, 020b program templates, 022c headcount import, 023a roll forward, 071a policy templates, 102b branding, 061e chat apps, 103a bulk owner invites, 102c demo environment, 18b product analytics, 022 allocation workspace.

## Decisions taken

- "Load sample data" exists only in the demo environment, a separate deployment; in production the button opens the demo instead. Recommended because the ledger is append-only and fictional money must never enter Hyland's books.
- The owner checklist ends at the first allocation, the activation milestone tracked in product analytics.
- Optional steps (branding, chat apps) can be skipped and undone; required steps cannot.
- "Show me" walkthroughs are short (3-5 steps), skippable and never block the screen.
- The 010 status view stays for Phase 2; this guide replaces it as the admin home from Phase 14.
