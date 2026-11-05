# 069a Policy assistant ("why was this blocked?", "is X allowed?")

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Requests > Policy assistant (`/policy-assistant`); "Why?" panel on blocked or warned requests (117, 056, 057, 058, 060, 119, 061d chat replies); "Check before you submit" panel on request forms.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the rule explanation of 069 and 077 and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                         |
| -------------------------------- | --------------------------------------------------------------------- |
| "Why was this blocked?" panel    | `design/stitch/069a-policy-assistant/why-blocked--desktop--light.png` |
| "Is this allowed?" answer        | `is-allowed--desktop--light.png`                                      |
| check before you submit (result) | `pre-check--desktop--light.png`                                       |
| AI off: rule explanation only    | `rules-only--desktop--light.png`                                      |
| mobile                           | `why-blocked--mobile--light.png`                                      |

## Purpose

Turn the rules engine's explanation into plain English and answer policy questions before people submit, so requesters understand why something was blocked or needs extra approval, what they can do within policy, and stop sending the same questions to finance. The decision always comes from the rules engine; the assistant only explains it.

## Roles

All requesters (EMP, EO, owners) for their own requests and questions about policies that apply to them; approvers for requests they decide; Finance Admin and Finance Controller for any request (support). Auditors read explanations on requests in scope.

## Entry points

"Why?" link next to every hard block, soft warning and approval-route line on 117, 056, 057, 058, 060 and 119; 061b and 061c cards "Why?" (opens 060 with the panel); 11a assistant questions about policy ("Can I buy alcohol for a team dinner in London?"); Requests > Policy assistant; 115 employee home "Policy questions".

## Content and actions

"Why was this blocked?" panel (sample Emma Clarke, London, REQ-2026-0466 team dinner: GBP 900.00 for 15 employees, of which GBP 300.00 is alcohol):

- Outcome line from the rules engine: hard block, error tone, "Blocked by Gifts, entertainment and alcohol policy v2 (rule R-31 v2)".
- Plain-language explanation (AI): "Alcohol is limited to GBP 10.00 per person for employee events in UK01. Your request has GBP 300.00 for 15 people, which is GBP 20.00 per person."
- What you can do (only options within policy): "Reduce alcohol to GBP 150.00 or less", "Remove alcohol from this request", "If there is a business reason, ask for an exception with an over-budget request (058)". Each option that maps to a form opens it prefilled; the person edits and resubmits.
- Facts used (from the rule evaluation): category Team events, attendees 15 employees, alcohol GBP 300.00 (USD 381.00 at the FY2026 plan rate), entity UK01, rule versions.
- Sources: the policy (072a) and rule (069) with versions; AI tag; Helpful or Not helpful.

"Is this allowed?" (policy assistant page or 11a):

- Question: "Can I buy gifts for my team's work anniversaries in Bengaluru?"
- Answer: "Yes, within limits. Gifts for employees in IN01 are capped at INR 2,000.00 per person per gift (USD 23.95) and count toward the INR 5,000.00 yearly limit per employee. Cash and gift cards are not allowed. Gifts above INR 2,000.00 need your Regional Manager's approval." with sources (Gifts, entertainment and alcohol policy v2; per-employee cap policy; rule versions) and "Check a request before you submit".
- If no rule covers the question: "No BudgetFlow policy limits this. Normal approval by your budget owner applies."

Check before you submit (panel on request forms, or the page form): budget, category, amount and currency, attendees (employees, clients), location, vendor; "Check" runs the rules in simulation and returns the would-be outcome: "Would need approval by Anand Kumar (above your USD 2,500.00 commitment limit)", "Would be blocked: blocked vendor", "No approval needed beyond your budget owner", each with the plain explanation.

## Data and permissions

The outcome, matched rules, facts and route come from the Phase 7 rules engine (rule evaluation explanation on the request; simulation endpoint of 077 run read-only in the asker's scope). The assistant endpoint in `ai.ts` (`POST /api/ai/policy-explain`) receives only the explanation structure, the policy texts that apply and the question; it never sees other people's requests. Policy texts and thresholds that apply to the asker are readable by them; delegation-of-authority limits of named people are not disclosed beyond "needs approval by" and the role. Simulation writes nothing. Each call writes an `ai_query_log` row.

## States

| State               | Behaviour                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Why blocked         | error-tone outcome, explanation, options within policy                                                                               |
| Why warned          | warning-tone outcome "You can submit; this needs Finance Controller approval because it is above USD 5,000.00"                       |
| Why this approver   | route explanation "Routed to Meera Iyer: the amount is above what your budget owner can approve for Events in IN01"                  |
| Is allowed          | answer with sources                                                                                                                  |
| Not covered         | "No BudgetFlow policy limits this. Normal approval applies."                                                                         |
| Pre-check result    | outcome tag (Allowed, Needs approval, Blocked) with explanation; "Start this request" opens the form prefilled                       |
| Workaround question | "How do I stay under the approval limit?" gets the policy text and "Requests split to stay under a limit are detected and reviewed." |
| Other person        | questions about someone else's request: "I can only explain your own requests or requests you're deciding."                          |
| AI off              | the rules engine's explanation shown as a list of matched rules and facts (as in 069), without the plain-language text               |
| Unavailable         | shared AI banner; rule explanation list shown                                                                                        |
| Loading / error     | `sat-ghost` lines; error with Retry                                                                                                  |

## Budget safety and audit

The assistant never changes a rule outcome, never overrides a block and never proposes a way around a control (splitting, re-timing or re-categorising a request); it lists only options that comply or the exception path. Resubmitting after the assistant's suggestion goes through the normal rules and approval; the resubmitted request's audit entry records the suggestion id. Explanations themselves are not audited (read-only); the query log records them.

## Responsive and accessibility

The panel becomes a bottom sheet on mobile (59a, 117 mobile layouts). The outcome line uses icon and words; facts are a definition list; options are buttons with full labels ("Reduce alcohol to GBP 150.00").

## Satori components

`sat-banner` (outcome), `sat-status-tag` (pre-check outcome), `sat-tag` (AI), `sat-rich-tooltip` (rule version details), `sat-ghost`, `sat-empty-state`; Angular Material side sheet and bottom sheet, form fields, select, snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

069 rule builder, 077 rule simulation, 072a gifts, entertainment and alcohol, 071 spending limits, 073a vendor controls, 058 over-budget request, 117 submit spending request, 060 request details, 119 request status, 011a assistant, 17c anomaly flags, 113a AI settings.

## Decisions taken

- The rules engine decides; the assistant only explains its decision in plain words. When AI is off, the same explanation appears as the rule list, so nobody loses the reason for a block.
- Suggestions list only compliant options or the exception path; questions about avoiding a limit get the policy text and a note that splits are detected. Recommended so the assistant never coaches people around controls.
- People see the role and name of who must approve, but never other people's approval limits.
- "Check before you submit" uses the same simulation as rule testing (077), in the asker's scope and without side effects.
