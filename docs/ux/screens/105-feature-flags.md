# 105 Feature flags

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Feature flags (`/admin/features`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                                            | Planned image                                                 |
| ------------------------------------------------ | ------------------------------------------------------------- |
| flags by area                                    | `design/stitch/105-feature-flags/default--desktop--light.png` |
| pilot rollout to locations                       | `pilot--desktop--light.png`                                   |
| money-affecting flag waiting for a second person | `pending-confirmation--desktop--light.png`                    |
| dependency missing                               | `dependency--desktop--light.png`                              |

## Purpose

Let Hyland switch optional capabilities on or off, try them first with a pilot group of locations or roles, and see what each one changes and who switched it, with a second person required for anything that changes how money or approvals work.

## Roles

Organization Admin (product and experience flags); Finance Admin (finance and approval flags, as requester); Finance Controller (confirms money-affecting flags); Super Admin (system flags such as maintenance mode, shown in 114); Auditor (read).

## Entry points

Settings > Feature flags; 113a (AI switches link here and back); 061e chat apps "Enable"; 099b "Card-limit push (off by default)"; 114 system health (system flags).

## Content and actions

Header bar: title, search, filter (area, status). Note: "Flags turn capabilities on or off for Hyland. There are no plans or paid tiers."

Flags grouped by area (row: name, description, status On, Off, Pilot; pilot group; needs; changed by and when; switch):

- Approvals: "Auto-approve within policy" (off; money-affecting; "Requests that every rule marks as auto-approvable are approved without a person. Off by default."); "Counter-offers from approvers" (on).
- Co-funding: "Transfer mode for co-funding requests" (on; earmark stays the default mode).
- Channels: "Slack app" (on; needs 061e connected), "Microsoft Teams app" (off), "Push notifications in the mobile app" (on).
- Integrations: "Push approved commitments to card limits" (off; money-affecting; needs a card connector, 099b).
- Events: "Waitlist auto-promotion" (on), "Post-event surveys" (on).
- AI: summary row "8 AI features, 7 on" linking to 113a.
- Engagement (P15, appear when built): recognition awards, wallets, gamified participation, polls and idea board.
- Ecosystem (P16): embeddable widgets, partner marketplace, connector for AI assistants.

Switch dialog: what changes, who is affected, rollout (Everyone; Pilot: locations or roles chosen from a picker, for example "Bengaluru and London"), reason (required), Turn on. Money-affecting flags: "Needs confirmation by a Finance Controller" and the flag stays Pending until Priya Raman confirms or declines.

## Data and permissions

`feature_flags` (key, enabled) extended in the P14 `admin.ts` contract with rollout scope (org units or roles), money-affecting marker, pending confirmation and history. `tenant.settings.manage` for product flags; Finance Admin requests finance flags; a new `flags.confirm_finance` action for Finance Controller (integrator adds); requester and confirmer must be different people. The API reads flags per request with the actor's org unit and role; turning a flag off takes effect on the next request and never undoes work already done (approved requests stay approved). `entitlements` and plan gating are not used (plans and entitlements, 105a, are deferred).

## States

| State                | Behaviour                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Default              | grouped list                                                                                         |
| Pilot                | info tag "Pilot: Bengaluru, London" on the row                                                       |
| Pending confirmation | warning tag "Waiting for Finance Controller" with requester and reason; Cancel request               |
| Declined             | neutral tag with the confirmer's reason                                                              |
| Dependency missing   | switch disabled with "Connect a card provider first (096)"                                           |
| Turn off dialog      | "Requests already auto-approved stay approved. New requests follow normal approval." reason required |
| Read only            | Auditor and other roles: no switches                                                                 |
| Loading / error      | `sat-ghost`; error banner with Retry                                                                 |

## Budget safety and audit

Money-affecting flags (auto-approve within policy, card-limit push) need two different people. Auto-approval applies only to requests that every matching rule marks as auto-approvable, still runs every control check (freeze, zero, available amount) and records the rule versions and facts behind it. Every flag change, pilot change, confirmation and decline is audited with old and new values and the reason.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Switches show "On", "Off" or "Pilot" as text next to them; each switch's accessible name includes the flag name.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (status, pending), `sat-tag` (area), `sat-banner`, `sat-ghost`; Angular Material slide toggles, dialog (switch, confirm), chips with autocomplete (pilot group), snackbar.

## Related screens and navigation

113a AI settings, 061e chat apps, 099b event-code and card-limit push, 076 notification and SLA policy, 102 company settings, 114 system health, 088 audit log.

## Decisions taken

- Flags can be piloted with chosen locations or roles rather than a percentage of users. Recommended because finance rollouts are planned by office and role, and percentages are hard to explain.
- Flags that change how money or approvals work need a Finance Controller's confirmation, with requester and confirmer different people.
- "Auto-approve within policy" exists and is off by default, as the plan's working assumption.
- No plans, tiers or upgrade prompts: flags are on or off for Hyland only (105a is deferred).
- Turning a flag off never reverses past effects.
