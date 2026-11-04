# 068 Create rule

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Dialog or page before the 069 builder.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/068-create-rule/default--desktop--light.png` (start choice), `from-template--desktop--light.png` (parameters).

## Purpose

Start a rule the easy way: pick a policy template and fill its parameters, start from the threshold table, duplicate an existing rule, or open a blank rule in the builder.

## Roles

Finance Admin, Organization Admin.

## Entry points

066 and 067 "Create rule"; 071a "Use template".

## Content and actions

Step 1, how to start (four cards): "From a policy template" (recommended), "From the threshold table", "Duplicate a rule", "Blank rule (condition builder)".

Step 2, from a template (sample "Gifts and entertainment cap"): template description; parameters as a short form: cap per person (USD 75.00), applies to categories (Gifts, Client entertainment), legal entities (all), outcome above the cap (Require Finance Controller approval or Block), explanation shown to users (prefilled, editable), effective from (1 Dec 2026). Live preview: the generated conditions and actions in plain English ("When category is Gifts or Client entertainment and amount per person is above USD 75.00, require Finance Controller approval").

Step 3, name and scope: rule name, id (generated, R-21), priority (suggested 45, between R-07 and R-14), scope (org units, request kinds). Footer: Cancel, "Create draft" (opens 069 with the draft), "Simulate first" (opens 077 with the draft).

## Data and permissions

Templates are parameterised rule definitions (071a); creating writes a draft version only (`rule:edit`); nothing takes effect until published in 069.

## States

| State      | Behaviour                                                           |
| ---------- | ------------------------------------------------------------------- |
| Default    | start choice                                                        |
| Template   | parameter form with live preview                                    |
| Validation | parameters required; cap above zero; effective date not in the past |
| Duplicate  | rule picker; the copy opens as a draft with "(copy)" in the name    |
| Success    | snackbar "Draft R-21 created" and the builder opens                 |

## Budget safety and audit

Creating a draft is audited; drafts never affect decisions. The preview uses the same wording as the explanation shown to requesters.

## Responsive and accessibility

Desktop and tablet; mobile shows "Create rules on a larger screen". Cards are radio buttons with labels.

## Related screens and navigation

066, 067, 069, 071a, 077.

## Assumptions and open questions

- None beyond the design review.
