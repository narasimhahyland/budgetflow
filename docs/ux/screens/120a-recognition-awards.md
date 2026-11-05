# 120a Recognition awards

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Employee experience > Recognition (`/recognition`, give `/recognition/new`, award `/recognition/:awardId`); program settings in Settings > Recognition (`/admin/recognition`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the employee pages of 115. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                       |
| ---------------------------------- | ------------------------------------------------------------------- |
| recognition feed and allowance     | `design/stitch/120a-recognition-awards/default--desktop--light.png` |
| give an award                      | `give--desktop--light.png`                                          |
| recipient chooses a reward         | `redeem--mobile--light.png`                                         |
| peer award waiting for the manager | `pending--desktop--light.png`                                       |
| program settings                   | `settings--desktop--light.png`                                      |

## Purpose

Let managers and peers thank people properly and pay for it from the Recognition budget, so recognition stops leaking into gift cards and expense claims: fixed award types per location, a short message, rewards from approved partners or through payroll, every award committed against the budget and counted toward taxable-benefit thresholds.

## Roles

People managers (give monetary awards within their recognition allowance); all employees (give thank-you notes; peer awards with manager approval); recipients (choose a reward); Organization Admin and Finance Admin (program settings); budget owners of the Recognition budgets (see spend).

## Entry points

Employee experience > Recognition; 115 employee home "Thank someone"; 039 employee profile "Give recognition"; 122b organizer profile "Nominate"; 54a survey "Thank the organizer"; Slack and Teams messages "Recognised" (opt-in).

## Content and actions

Feed: public recognitions (recipient opted in): "Meera Iyer recognised Rahul Verma: Spot award. 'The Diwali celebration ran perfectly for 400 people.' Teamwork." with reactions; filters (my location, my team, all).

My allowance (managers): "Recognition allowance Q4: USD 300.00 left of USD 500.00 (Bengaluru Recognition)".

Give an award: recipient (directory search), type (from the location's program):

- Thank-you note: no money.
- Spot award: USD 50.00 (Bengaluru shown as INR 4,175.00 at the FY2026 plan rate).
- Peer award: USD 25.00, needs the giver's manager to approve.
- Team award: USD 200.00 for a team meal (creates a request on the team budget instead of a personal reward).
- Message (required, 20-500 characters), value tag (Customer focus, Teamwork, Ownership, Learning), visibility (Public in the feed, Private to the recipient and their manager).
- Check line: "Within your allowance. Counts toward Rahul's USD 500.00 yearly per-person cap (USD 220.00 used)."

Recipient: notification and award page; reward choice: "Add to my next payroll (taxable)" or "Choose from the partner catalogue" (92d gifts and experiences); cash and gift cards are not offered.

Program settings (Organization Admin, Finance Admin): award types per location (amount, approval needed, who can give), manager allowances per quarter (funded from each location's Recognition budget), feed default visibility (Private), reward options (payroll, partner catalogue), value tags.

## Data and permissions

New P15 `recognition_awards` table (per the phase handoff): giver, recipient, type, amount, message, visibility, status (Pending approval, Awarded, Redeemed, Cancelled), funding budget, reward choice. Each manager's quarterly allowance is one commitment on the location's Recognition budget, approved by that budget's owner when the allowance is granted; manager awards consume it and unused allowance is released at quarter end. Peer awards are requests on the same budget that need the giver's manager's approval. Redemption creates the actual through payroll export (94b) or the partner invoice (92d). Awards update the employee benefit ledger (80h) and per-person cap (072). Recipients cannot be the giver; approvers cannot approve awards to themselves. Feed visibility respects the recipient's choice.

## States

| State            | Behaviour                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Feed             | as above                                                                                                                   |
| Give             | form with check line                                                                                                       |
| Over allowance   | error "This is USD 50.00 above your remaining allowance" with "Ask for a top-up" (request to the owner)                    |
| Cap warning      | warning "Rahul would pass the USD 500.00 yearly cap; this award is reported as a taxable benefit" (soft, policy-dependent) |
| Pending approval | warning tag "Waiting for Anand Kumar" on peer awards                                                                       |
| Awarded          | success snackbar; recipient notified                                                                                       |
| Redeemed         | tag "Added to November payroll" or "Partner gift chosen"                                                                   |
| Frozen budget    | info banner "Bengaluru Recognition is paused; thank-you notes still work"; monetary types disabled with the reason         |
| Empty feed       | "No public recognitions yet" with "Thank someone"                                                                          |
| Loading / error  | `sat-ghost`; error banner with Retry                                                                                       |

## Budget safety and audit

Every monetary award is a commitment on a Recognition budget and passes the usual checks (available amount, freeze and zero controls, approvals); thank-you notes move no money. Rewards go through payroll or approved partners, never cash or gift cards, and count toward per-person caps and benefit-in-kind thresholds. Giving, approving, cancelling and redeeming are audited.

## Responsive and accessibility

Mobile first for giving and redeeming. Award types are radio cards with amounts in text; the feed is a list of articles with the giver, recipient and award in the heading.

## Satori components

`sat-interactive-card` (feed items, award types), `sat-avatar`, `sat-category-tag` (value tags), `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`, `satImportantButton` (Give award); Angular Material radio group, form fields, autocomplete (recipient), dialog, snackbar; `bf-money`.

## Related screens and navigation

115 employee home, 039 employee profile, 122 my activity, 122b organizer recognition, 92d partner marketplace, 094b payroll exports, 080h benefit ledger, 072 category policy (per-person cap), 072a gifts policy, 102b program branding ("Thank You").

## Decisions taken

- Monetary awards are fixed amounts per type and location, funded from Recognition budgets and committed like any spend. Recommended so recognition spend is visible and controlled.
- Rewards are paid through payroll (taxable) or chosen from approved partners; there is no cash or gift card option, closing the gap the catalog describes.
- Peer awards need the giver's manager's approval; manager awards draw on a quarterly allowance that the Recognition budget owner approves once as a commitment, so each award does not need its own approval.
- Recognition is private by default; recipients choose whether it appears in the feed.
- Awards count toward per-person caps and benefit-in-kind thresholds.
