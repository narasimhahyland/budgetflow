# Screen inventory

All 124 specified screens plus the screens added by the product and finance review, with the phase that builds each one fully working and its primary roles. Screens are designed in Stitch first and implemented only after approval (light theme only; dark theme deferred). Review-added screens are lettered within their group (`56a`). The build plan's group-to-phase mapping applies; this file is the per-screen record. Role abbreviations: [authorization.md](../architecture/authorization.md).

"Stitch" marks screens with an existing design in the original Stitch project (start screens are redesigned first as Satori variants). Status for every screen: not built (Phase 1 builds the backend foundation only).

Phase 3 built screens 6, 7, 9, 22c, 33-42, 102a, 104a, 106, 106a, 106b, 106c, 107, 107a, 108 and 108a as 13 pages (`/org/*` and `/finance/*`). Screens 22c, 107 and 108 follow their proposed Stitch designs (parity notes in `evidence/phase-03/visual-qa/design-parity.md`); the others were built from the design system without a Stitch design and await design review. Specs: `docs/ux/screens/` (022c-hr-headcount-import, 033, 038, 039, 041, 042, 102a, 104a, 106a, 106b, 106c, 107-exchange-rates, 108-fiscal-calendar).

Phase 8 to 12 screens are specified spec-first in `docs/ux/screens/` (images pending a later Stitch session; status in [review-log.md](review-log.md)). Screens 47e, 59b, 59c, 61d and 61e (Phases 8 and 9), 80g, 80h and 87c (Phase 11) and 94a, 94b and 99b (Phase 12) were added with those batches for plan features that had no screen. Phase 10 reports share the report frame defined in `079-reports-dashboard.md`; Phase 12 connectors share the connector frame defined in `092-integrations-dashboard.md`.

Phase 13 to 16 screens are specified spec-first in the same way. Screens 61f and 113a (Phase 13) were added for plan features that had no screen (questions in Slack and Teams; AI feature switches and the AI query log), and the shared pattern 000b (Phase 14) for chart table alternatives and the keyboard-first grid. Every AI surface uses the AI output pattern defined in `011a-ai-assistant-panel.md`. Screens 105a (plans and entitlements) and 102e (white-label for resellers) are deferred with the multi-customer backlog and are not specified.

## Shared patterns

Specs that apply across many screens. The design system (000) and the application shell (000a) are start-screen specs and are not counted in the tables below.

| #    | Pattern                                          | Build phase | Primary roles | Notes        |
| ---- | ------------------------------------------------ | ----------- | ------------- | ------------ |
| 000b | Chart table alternatives and keyboard-first grid | P14         | All roles     | review-added |

## Group 1: Authentication and onboarding

| #   | Screen                                  | Build phase | Primary roles                       | Notes        |
| --- | --------------------------------------- | ----------- | ----------------------------------- | ------------ |
| 1   | Login                                   | P2          | All roles                           |              |
| 2   | Single sign-on login                    | P2          | All roles                           |              |
| 3   | MFA verification                        | P2          | All roles                           |              |
| 4   | Forgot password                         | P2          | All roles                           |              |
| 5   | First-time organization setup           | P2          | All roles (sign-in); OA, SA (setup) |              |
| 6   | Organization and legal-entity setup     | P3          | All roles (sign-in); OA, SA (setup) |              |
| 7   | Fiscal year and currency setup          | P3          | All roles (sign-in); OA, SA (setup) |              |
| 8   | Role and permission setup               | P2          | All roles (sign-in); OA, SA (setup) |              |
| 9   | Initial organization hierarchy import   | P3          | All roles (sign-in); OA, SA (setup) |              |
| 10  | Setup completion dashboard              | P2          | All roles (sign-in); OA, SA (setup) |              |
| 10a | Guided setup checklist with sample data | P14         | OA, FA                              | review-added |

## Group 2: Executive and finance dashboards

| #   | Screen                                                  | Build phase | Primary roles                            | Notes           |
| --- | ------------------------------------------------------- | ----------- | ---------------------------------------- | --------------- |
| 11  | Executive dashboard                                     | P10         | CEO, FA, FC, AN; owners scoped           | Stitch, start 3 |
| 11a | AI assistant panel (plain-language questions)           | P13         | All roles within scope                   | review-added    |
| 11b | Auto-drafted leadership summary                         | P15         | CEO, FA, FC                              | review-added    |
| 12  | Finance controller dashboard                            | P10         | CEO, FA, FC, AN; owners scoped           |                 |
| 13  | Budget health overview                                  | P10         | CEO, FA, FC, AN; owners scoped           |                 |
| 14  | Organization-wide budget hierarchy                      | P4          | CEO, FA; owners scoped; FC, AUD, AN read | Stitch, start 4 |
| 15  | Budget utilization analytics                            | P10         | CEO, FA, FC, AN; owners scoped           |                 |
| 15a | Fairness view: spend per head by location               | P10         | CEO, FA, AN                              | review-added    |
| 15b | Participation and reach                                 | P10         | CEO, FA, AN, OA                          | review-added    |
| 16  | Budget forecast and variance view                       | P10         | CEO, FA, FC, AN; owners scoped           |                 |
| 16a | Board and FP&A pack                                     | P10         | CEO, FA, FC, AN                          | review-added    |
| 16b | Under/overspend forecasts and nudges                    | P13         | Owners, FA                               | review-added    |
| 17  | Alerts and exceptions dashboard                         | P10         | CEO, FA, FC, AN; owners scoped           | Stitch          |
| 17a | Exceptions dashboard                                    | P10         | FA, FC, AUD                              | review-added    |
| 17b | Red-flag analytics                                      | P15         | FC, AUD                                  | review-added    |
| 17c | Anomaly flags (split, duplicate, unusual cost per head) | P13         | FC, AUD, FA                              | review-added    |
| 18  | Pending approvals dashboard                             | P10         | Approvers (CEO, FA, FC, owners)          |                 |
| 18a | Approval performance (cycle time, bottlenecks)          | P10         | FA, FC, CEO                              | review-added    |
| 18b | Product analytics dashboard                             | P10         | OA, FA                                   | review-added    |

## Group 3: Budget management

| #   | Screen                                             | Build phase | Primary roles                                             | Notes           |
| --- | -------------------------------------------------- | ----------- | --------------------------------------------------------- | --------------- |
| 19  | Budget list                                        | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 20  | Create budget                                      | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 20a | Budget-plan spreadsheet import with column mapping | P4          | FA                                                        | review-added    |
| 20b | Program templates                                  | P4          | FA, OA                                                    | review-added    |
| 21  | Budget details                                     | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 22  | Budget allocation workspace                        | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read | Stitch, start 5 |
| 22a | Per-head driver allocation                         | P4          | RM, LM, FA                                                | review-added    |
| 22b | Allocation grid with paste from Excel              | P4          | Owners, FA                                                | review-added    |
| 22c | HR headcount import and refresh                    | P3          | OA, FA                                                    | review-added    |
| 22d | Suggested allocations                              | P13         | Owners, FA                                                | review-added    |
| 23  | Hierarchical budget tree                           | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read | Stitch, start 4 |
| 23a | Roll forward or clone last year's tree             | P4          | FA, CEO                                                   | review-added    |
| 24  | Allocate budget to child unit                      | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 25  | Transfer budget                                    | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 26  | Reduce budget                                      | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 27  | Freeze budget                                      | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 28  | Set budget to zero                                 | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 29  | Revise budget                                      | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 29a | Contingency reserve release                        | P4          | FA, CEO                                                   | review-added    |
| 30  | Budget version history                             | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 31  | Budget comparison view                             | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 31a | What-if reallocation scenarios                     | P15         | CEO, FA                                                   | review-added    |
| 32  | Budget calendar and fiscal-period view             | P4          | CEO, FA; owners (BO, DH, RM, LM) scoped; FC, AUD, AN read |                 |
| 32a | Period phasing editor                              | P4          | Owners, FA                                                | review-added    |

## Group 4: Organization and people

| #   | Screen                                  | Build phase | Primary roles                    | Notes |
| --- | --------------------------------------- | ----------- | -------------------------------- | ----- |
| 33  | Organization hierarchy                  | P3          | OA; FA read; owners read own org |       |
| 34  | Organization chart                      | P3          | OA; FA read; owners read own org |       |
| 35  | Department details                      | P3          | OA; FA read; owners read own org |       |
| 36  | Team details                            | P3          | OA; FA read; owners read own org |       |
| 37  | Location management                     | P3          | OA; FA read; owners read own org |       |
| 38  | Employee directory                      | P3          | OA; FA read; owners read own org |       |
| 39  | Employee profile                        | P3          | OA; FA read; owners read own org |       |
| 40  | Reporting relationship management       | P3          | OA; FA read; owners read own org |       |
| 41  | Cost-center management                  | P3          | OA; FA read; owners read own org |       |
| 42  | Organization import and synchronization | P3          | OA; FA read; owners read own org |       |

## Group 5: Events and team activities

| #   | Screen                                                         | Build phase | Primary roles                 | Notes           |
| --- | -------------------------------------------------------------- | ----------- | ----------------------------- | --------------- |
| 43  | Events dashboard                                               | P9          | EO, LM, RM; owners scoped; FC |                 |
| 43a | Holiday and festival overlay calendar                          | P15         | EO, LM, RM                    | review-added    |
| 44  | Event list                                                     | P5          | EO, LM, RM; owners scoped; FC |                 |
| 44a | Date and activity polls, idea board                            | P15         | EO, EMP                       | review-added    |
| 45  | Create event                                                   | P5          | EO, LM, RM; owners scoped; FC | Stitch, start 6 |
| 45a | Event templates, recurring events, clone                       | P9          | EO, LM                        | review-added    |
| 45b | Event planning copilot                                         | P15         | EO                            | review-added    |
| 46  | Event details                                                  | P5          | EO, LM, RM; owners scoped; FC |                 |
| 46a | Live co-funding board                                          | P5          | EO, contributing owners       | review-added    |
| 46b | Checklist, tasks and agenda                                    | P9          | EO, co-organizers             | review-added    |
| 47  | Add locations and participants                                 | P5          | EO, LM, RM; owners scoped; FC |                 |
| 47a | Invitations and RSVP                                           | P9          | EO, EMP                       | review-added    |
| 47b | Attendee needs (dietary, accessibility, travel, photo consent) | P9          | EO, EMP                       | review-added    |
| 47c | QR or mobile check-in                                          | P15         | EO                            | review-added    |
| 47d | Remote and hybrid participation                                | P15         | EO                            | review-added    |
| 47e | Attendance and per-head recalculation                          | P9          | EO, contributing owners       | review-added    |
| 48  | Event budget request                                           | P5          | EO, LM, RM; owners scoped; FC | Stitch, start 6 |
| 49  | Cross-location cost allocation                                 | P5          | EO, LM, RM; owners scoped; FC | Stitch          |
| 50  | Event approval workflow                                        | P5          | EO, LM, RM; owners scoped; FC |                 |
| 51  | Event expense and commitment tracking                          | P5          | EO, LM, RM; owners scoped; FC |                 |
| 51a | Vendor quotes: request, compare, select                        | P9          | EO, LM                        | review-added    |
| 52  | Event supporting documents                                     | P5          | EO, LM, RM; owners scoped; FC |                 |
| 53  | Event budget reconciliation                                    | P6          | EO, LM, RM; owners scoped; FC |                 |
| 53a | Intercompany recharge schedule                                 | P5          | FA, FC, tax approver          | review-added    |
| 54  | Close event                                                    | P6          | EO, LM, RM; owners scoped; FC |                 |
| 54a | Post-event survey and photo gallery                            | P9          | EO, EMP                       | review-added    |
| 54b | Event ROI scorecard                                            | P9          | EO, owners, FA                | review-added    |

## Group 6: Requests and approvals

| #   | Screen                                                            | Build phase | Primary roles                                      | Notes                                       |
| --- | ----------------------------------------------------------------- | ----------- | -------------------------------------------------- | ------------------------------------------- |
| 55  | My requests                                                       | P5          | All requesters; approvers within DoA               |                                             |
| 56  | Create budget request                                             | P5          | All requesters; approvers within DoA               |                                             |
| 56a | Inter-Director Budget Contribution Request ("Co-funding request") | P5          | Requesting and giving owners                       | review-added, Stitch ("Director Transfers") |
| 57  | Create additional-fund request                                    | P5          | All requesters; approvers within DoA               |                                             |
| 58  | Create over-budget request                                        | P5          | All requesters; approvers within DoA               |                                             |
| 59  | Approval inbox                                                    | P5          | Approvers within DoA (CEO, FA, FC, BO, DH, RM, LM) | Stitch, start 7                             |
| 59a | Mobile web approvals (installable app)                            | P8          | Approvers                                          | review-added                                |
| 59b | Mobile balance check and camera receipts                          | P8          | Owners, EO, EMP                                    | review-added                                |
| 59c | Notification channels and push settings                           | P8          | All roles (own settings)                           | review-added                                |
| 60  | Request details                                                   | P5          | All requesters; approvers within DoA               | Stitch                                      |
| 60a | Comments, mentions, follow and watch                              | P8          | All roles within scope                             | review-added                                |
| 61  | Approval decision screen                                          | P5          | Approvers within DoA                               | Stitch                                      |
| 61a | Actionable approval email                                         | P5          | Approvers                                          | review-added                                |
| 61b | Slack approval card                                               | P8          | Approvers                                          | review-added                                |
| 61c | Microsoft Teams approval card                                     | P8          | Approvers                                          | review-added                                |
| 61d | Slack and Teams: balance check, quick request and alerts          | P8          | Owners, requesters, approvers                      | review-added                                |
| 61e | Slack and Teams app setup and account linking                     | P8          | IA; OA, FA read; all users link                    | review-added                                |
| 61f | Slack and Teams: ask BudgetFlow (plain-language questions)        | P13         | All roles within scope (linked accounts)           | review-added                                |
| 62  | Delegated approval screen                                         | P7          | Delegates                                          |                                             |
| 63  | Escalated approval screen                                         | P7          | Escalation approvers (FC, CEO)                     |                                             |
| 64  | Request history                                                   | P5          | All requesters; approvers within DoA               | Stitch                                      |
| 64a | Role-based digest templates                                       | P8          | All roles                                          | review-added                                |
| 65  | Rejected request and resubmission                                 | P7          | All requesters; approvers within DoA               |                                             |

## Group 7: Rules and policies

| #   | Screen                                     | Build phase | Primary roles   | Notes           |
| --- | ------------------------------------------ | ----------- | --------------- | --------------- |
| 66  | Rules dashboard                            | P7          | FA, OA; FC read |                 |
| 67  | Rule list                                  | P7          | FA, OA; FC read |                 |
| 68  | Create rule                                | P7          | FA, OA; FC read |                 |
| 69  | Rule builder                               | P7          | FA, OA; FC read | Stitch, start 8 |
| 69a | Policy assistant ("why was this blocked?") | P13         | All requesters  | review-added    |
| 70  | Approval routing configuration             | P7          | FA, OA; FC read |                 |
| 70a | Delegation-of-authority matrix admin       | P7          | FA              | review-added    |
| 71  | Spending-limit configuration               | P7          | FA, OA; FC read |                 |
| 71a | Policy templates and threshold table       | P7          | FA              | review-added    |
| 72  | Category-policy configuration              | P7          | FA, OA; FC read |                 |
| 72a | Gifts, entertainment and alcohol policy    | P7          | FA              | review-added    |
| 73  | Location-policy configuration              | P7          | FA, OA; FC read |                 |
| 73a | Vendor controls                            | P7          | FA              | review-added    |
| 74  | Over-budget policy                         | P7          | FA, OA; FC read |                 |
| 74a | Post-spend exception queue                 | P7          | FC, FA          | review-added    |
| 75  | Freeze and zero-budget policy              | P7          | FA, OA; FC read |                 |
| 76  | Notification and escalation policy         | P7          | FA, OA; FC read |                 |
| 77  | Rule simulation and testing                | P7          | FA, OA; FC read | Stitch          |
| 78  | Rule version history                       | P7          | FA, OA; FC read | Stitch          |

## Group 8: Reporting and audit

| #   | Screen                                   | Build phase | Primary roles                       | Notes        |
| --- | ---------------------------------------- | ----------- | ----------------------------------- | ------------ |
| 79  | Reports dashboard                        | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 80  | Budget versus actual report              | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 80a | Actuals import                           | P6          | FA, FC                              | review-added |
| 80b | Unmatched actuals queue                  | P6          | FA, FC, owners scoped               | review-added |
| 80c | GL tie-out and monthly sign-off          | P6          | FC, FA                              | review-added |
| 80d | Accrual proposals                        | P6          | FC, FA                              | review-added |
| 80e | Period close and lock                    | P11         | FC, FA                              | review-added |
| 80f | Transaction matching review (AI)         | P13         | FC, FA                              | review-added |
| 80g | Tax-aware consumption (GST/VAT recovery) | P11         | FA, FC, tax approver                | review-added |
| 80h | Employee benefit ledger and thresholds   | P11         | FA, FC, AUD                         | review-added |
| 81  | Allocation report                        | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 82  | Utilization report                       | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 83  | Location comparison report               | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 84  | Department comparison report             | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 85  | Event spending report                    | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 85a | Commitment hygiene (aging, auto-release) | P6          | Owners, FC                          | review-added |
| 86  | Unused and expired budget report         | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 86a | Reclaim and redistribute unused budget   | P11         | FA, CEO, owners                     | review-added |
| 87  | Forecast and variance report             | P10         | FA, FC, AUD, AN, CEO; owners scoped |              |
| 87a | Forecast cycle with variance commentary  | P11         | Owners, FA                          | review-added |
| 87b | Year-end run                             | P11         | FA, FC                              | review-added |
| 87c | Rollover, lapse and sweep policies       | P11         | FA; FC, AUD read                    | review-added |
| 88  | Audit log                                | P5          | AUD, FA, FC, CEO                    | start 9      |
| 88a | One-click evidence pack                  | P10         | AUD, FC                             | review-added |
| 89  | Allocation history                       | P4          | FA, FC, AUD; owners scoped          |              |
| 90  | Approval history                         | P7          | AUD, FA, FC; approvers own          | Stitch       |
| 91  | Export and scheduled reports             | P10         | FA, FC, AUD, AN, CEO; owners scoped | Stitch       |

## Group 9: Integrations

| #    | Screen                                               | Build phase | Primary roles | Notes        |
| ---- | ---------------------------------------------------- | ----------- | ------------- | ------------ |
| 92   | Integrations dashboard                               | P12         | IA; FA read   |              |
| 92a  | BI connector                                         | P16         | IA, AN        | review-added |
| 92b  | No-code connectors                                   | P16         | IA            | review-added |
| 92c  | Connector for AI assistants (Model Context Protocol) | P16         | IA            | review-added |
| 92d  | Partner marketplace                                  | P16         | EO, FA, IA    | review-added |
| 93   | HR system integration                                | P12         | IA; FA read   |              |
| 94   | ERP integration                                      | P12         | IA; FA read   |              |
| 94a  | Planning integration (Adaptive Planning)             | P12         | IA, FA, CEO   | review-added |
| 94b  | Finance and payroll exports                          | P12         | FA, FC        | review-added |
| 95   | Expense-management integration                       | P12         | IA; FA read   |              |
| 96   | Corporate-card integration                           | P12         | IA; FA read   |              |
| 97   | Calendar integration                                 | P12         | IA; FA read   |              |
| 98   | Identity and SSO integration                         | P12         | IA; FA read   |              |
| 99   | Data synchronization status                          | P12         | IA; FA read   |              |
| 99a  | Cross-source duplicate review                        | P12         | FC, IA        | review-added |
| 99b  | Event-code and card-limit push                       | P12         | IA; FA read   | review-added |
| 100  | Integration error and retry screen                   | P12         | IA; FA read   |              |
| 101  | API key and webhook management                       | P12         | IA; FA read   |              |
| 101a | Public API docs and sandbox                          | P12         | IA            | review-added |

## Group 10: Administration

| #    | Screen                                             | Build phase | Primary roles              | Notes        |
| ---- | -------------------------------------------------- | ----------- | -------------------------- | ------------ |
| 102  | Tenant settings                                    | P2          | OA, FA, SA (system health) |              |
| 102a | Legal entities                                     | P3          | FA, OA                     | review-added |
| 102b | Program branding                                   | P14         | OA                         | review-added |
| 102c | Demo environment and rules sandbox                 | P14         | OA, FA                     | review-added |
| 102d | Embeddable balance and events widgets              | P16         | OA, IA                     | review-added |
| 102e | White-label for resellers                          | Deferred    | SA, OA                     | deferred     |
| 103  | User and role management                           | P2          | OA                         |              |
| 103a | Bulk owner invites                                 | P14         | OA                         | review-added |
| 104  | Permission matrix                                  | P2          | OA; AUD read               |              |
| 104a | Delegation-of-authority matrix (seeded, read-only) | P3          | FA, FC, AUD                | review-added |
| 105  | Feature flags                                      | P14         | OA, FA, SA (system health) |              |
| 105a | Plans and entitlements                             | Deferred    | SA, OA                     | deferred     |
| 106  | Categories and custom fields                       | P3          | OA, FA                     |              |
| 106a | GL accounts and category-to-GL mapping             | P3          | FA                         | review-added |
| 106b | Reason-code taxonomy                               | P3          | FA, OA                     | review-added |
| 106c | Vendor master                                      | P3          | FA                         | review-added |
| 107  | Currency and exchange-rate settings                | P3          | FA                         |              |
| 107a | Exchange-rate types and plan-rate lock             | P3          | FA                         | review-added |
| 108  | Fiscal-period settings                             | P3          | FA, FC                     |              |
| 108a | Fiscal calendar variants (4-4-5, 52/53-week)       | P3          | FA, FC                     | review-added |
| 109  | Notification settings                              | P14         | OA, FA, SA (system health) |              |
| 110  | Document and attachment settings                   | P14         | OA, FA, SA (system health) |              |
| 111  | Data-retention settings                            | P14         | OA, FA, SA (system health) |              |
| 112  | Security settings                                  | P14         | OA, FA, SA (system health) |              |
| 113  | Audit and compliance settings                      | P14         | OA, FA, SA (system health) |              |
| 113a | AI settings and query log                          | P13         | OA; FA, AUD read           | review-added |
| 114  | System health dashboard                            | P14         | SA, OA                     |              |

## Group 11: Employee experience

| #    | Screen                                            | Build phase | Primary roles                    | Notes            |
| ---- | ------------------------------------------------- | ----------- | -------------------------------- | ---------------- |
| 115  | Employee dashboard                                | P5          | EMP, EO; all roles for own items | Stitch, start 10 |
| 115a | Native iOS and Android layouts                    | P16         | EMP, approvers                   | review-added     |
| 116  | Available budgets                                 | P5          | EMP, EO; all roles for own items |                  |
| 116a | "Your team's budget" card                         | P14         | EMP                              | review-added     |
| 117  | Submit spending request                           | P5          | EMP, EO; all roles for own items |                  |
| 117a | Hand-off of approved spend to a prefilled expense | P12         | EMP, EO                          | review-added     |
| 118  | Request event funding                             | P5          | EMP, EO; all roles for own items |                  |
| 119  | View request status                               | P5          | EMP, EO; all roles for own items |                  |
| 120  | View approved allocations                         | P5          | EMP, EO; all roles for own items |                  |
| 120a | Recognition awards                                | P15         | Managers, EMP                    | review-added     |
| 120b | Wellbeing and learning wallets                    | P15         | EMP                              | review-added     |
| 121  | Upload receipt or document                        | P5          | EMP, EO; all roles for own items |                  |
| 121a | Receipt and quote extraction                      | P13         | EMP, EO                          | review-added     |
| 122  | Personal activity history                         | P14         | EMP, EO; all roles for own items |                  |
| 122a | Gamified participation                            | P15         | EMP, EO                          | review-added     |
| 123  | Notifications and tasks                           | P8          | EMP, EO; all roles for own items |                  |
| 124  | Profile and preferences                           | P2          | All roles                        |                  |

## Screens per build phase

| Phase    | Specified + review-added screens      |
| -------- | ------------------------------------- |
| P2       | 11                                    |
| P3       | 24                                    |
| P4       | 23                                    |
| P5       | 29                                    |
| P6       | 7                                     |
| P7       | 22                                    |
| P8       | 10                                    |
| P9       | 9                                     |
| P10      | 24                                    |
| P11      | 7                                     |
| P12      | 16                                    |
| P13      | 9                                     |
| P14      | 14                                    |
| P15      | 11                                    |
| P16      | 6                                     |
| Deferred | 2 (105a, 102e)                        |
| Total    | 224 (124 specified, 100 review-added) |

## Role-to-screen matrix

Access by screen group: **F** full use, **S** scoped to owned budgets, org subtree or own items, **R** read only, **–** no access. The API enforces this through `PolicyService`; the UI hides what the API reports the user cannot do.

| Screen group                                 | SA  | OA  | CEO | FA  | FC  | BO  | DH  | RM  | LM  | EO  | EMP | AUD | IA  | AN  |
| -------------------------------------------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| G1 Authentication and onboarding             |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |  F  |
| G2 Executive and finance dashboards          |  –  |  –  |  F  |  F  |  F  |  S  |  S  |  S  |  S  |  –  |  –  |  R  |  –  |  R  |
| G3 Budget management                         |  –  |  –  |  F  |  F  |  R  |  S  |  S  |  S  |  S  |  R  |  –  |  R  |  –  |  R  |
| G4 Organization and people                   |  –  |  F  |  R  |  R  |  R  |  S  |  S  |  S  |  S  |  –  |  –  |  R  |  –  |  R  |
| G5 Events and team activities                |  –  |  –  |  S  |  S  |  R  |  S  |  S  |  S  |  S  |  F  |  S  |  R  |  –  |  R  |
| G6 Requests and approvals                    |  –  |  –  |  S  |  S  |  F  |  S  |  S  |  S  |  S  |  S  |  S  |  R  |  –  |  –  |
| G7 Rules and policies                        |  –  |  F  |  R  |  F  |  R  |  –  |  –  |  –  |  –  |  –  |  –  |  R  |  –  |  –  |
| G8 Reporting and audit                       |  –  |  –  |  F  |  F  |  F  |  S  |  S  |  S  |  S  |  –  |  –  |  F  |  –  |  R  |
| G9 Integrations                              |  –  |  –  |  –  |  R  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  R  |  F  |  –  |
| G10 Administration                           |  S  |  F  |  –  |  F  |  R  |  –  |  –  |  –  |  –  |  –  |  –  |  R  |  S  |  –  |
| G11 Employee experience                      |  –  |  –  |  S  |  S  |  –  |  S  |  S  |  S  |  S  |  S  |  F  |  –  |  –  |  –  |
| Finance operations (80a-80h, 85a-87c)        |  –  |  –  |  R  |  F  |  F  |  S  |  S  |  S  |  S  |  –  |  –  |  R  |  –  |  R  |
| Channels and AI surfaces (59a-64a, 11a, 69a) |  –  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |

Super Admin (SA) sees tenant financial data only under an audited break-glass grant. Approval authority on G6 screens also requires a delegation-of-authority limit; ownership alone never satisfies an approval.
