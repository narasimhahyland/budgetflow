# 010 Setup completion dashboard

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/010-setup-completion/default--desktop--light.png` (in progress), `ready--desktop--light.png`.

## Purpose

Show the Organization Admin and Finance Admin what setup is done, what is left, who owns each step, and when BudgetFlow is ready for budget owners to be invited.

## Roles

Organization Admin, Finance Admin (finance steps), Super Admin (read during provisioning).

## Entry points

Home for OA while setup is incomplete; 005 after the last step; Settings > Setup.

## Content and actions

Standard shell. Header "Setup", progress "5 of 8 done".

Checklist (each row: step, owner, status tag, action):

1. Company basics (OA) - Done.
2. Legal entities (FA) - Done, 3 entities (IN01, US01, UK01).
3. Fiscal year and currency (FA) - Done, FY2026 January-December, plan rates locked.
4. Organization import (OA) - Done, 1,231 people, 42 cost centers.
5. Roles and people (OA) - Done.
6. HR headcount import (OA, FA) - To do, "Import headcount" (022c).
7. First budget (FA or CEO) - To do, "Create budget" (020) or "Roll forward last year" (023a).
8. Invite budget owners (OA) - Locked until 7 is done ("Owners need a budget to own").

Readiness card: "Ready to invite budget owners when steps 6 and 7 are done"; "Invite owners" disabled with that reason. Side card: sample data is not available here (the demo environment is a separate deployment, Phase 14).

## Data and permissions

Setup status computed server-side from tenant settings and master data counts. OA and FA see all steps; actions open the owning screens.

## States

| State           | Behaviour                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| In progress     | as above                                                                           |
| Ready           | success banner "Setup complete"; Invite owners enabled                             |
| Blocked step    | step with an error (for example an import with errors) shows the reason and a link |
| Loading / error | skeleton rows; error banner                                                        |

## Budget safety and audit

No money moves. Steps write their own audit entries.

## Responsive and accessibility

Tablet fine; mobile shows the checklist. Status tags carry text.

## Related screens and navigation

005, 006, 007, 008, 009, 022c, 020, 023a, 103, 103a (bulk owner invites, P14).

## Assumptions and open questions

- The guided checklist with sample data (10a) is Phase 14; this page stays the P2 status view.
