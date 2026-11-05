# 011b Auto-drafted leadership summary and variance commentary

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Insights > Leadership summary (`/insights/summary`, one summary `/insights/summary/:periodId`); "Draft commentary" in the 87a forecast cycle owner form.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the board pack of 16a and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| summary draft with linked figures      | `design/stitch/011b-leadership-summary-commentary/default--desktop--light.png` |
| section regenerated, edits highlighted | `editing--desktop--light.png`                                                  |
| approved summary                       | `approved--desktop--light.png`                                                 |
| commentary draft in the forecast cycle | `commentary--desktop--light.png`                                               |

## Purpose

Save leaders and owners from writing the monthly narrative by hand: draft the leadership summary of a closed period and the owner's variance commentary from BudgetFlow's own figures and drivers, with every number linked to its source, so people only check, edit and approve the words.

## Roles

CEO, Finance Admin and Finance Controller (create, edit, approve summaries); Read-only Analyst (read approved summaries); budget owners (draft their own variance commentary in 87a). Summaries cover what the author can see (company-wide for these roles).

## Entry points

Insights > Leadership summary; 16a board pack "Add a narrative"; 080e period close "Period closed: draft the summary"; 87a owner form "Draft commentary" next to the required commentary field; finance weekly digest "October summary ready to review".

## Content and actions

Summary list: period, status (AI draft, Edited, Approved), author, approved by, updated. "Draft summary" for the latest closed period (October 2026).

Summary page (October 2026, from the closed-period snapshot):

- Header: period, snapshot tag "Closed period snapshot, 3 Nov", status tag, AI tag, Export (PDF), Approve.
- Sections, each with Regenerate, Edit and its Sources:
  - Headline: "October spend was USD 48,200.00 against a phased plan of USD 52,000.00 (92.7%). Year to date the company has used 71.4% of authorized budgets, with USD 98,400.00 available company-wide."
  - Variances: "United States Region is USD 3,100.00 over its October plan, driven by the Westlake Thanksgiving event booked early (USD 4,400.00 committed). India Region is USD 2,600.00 under plan; Diwali celebrations move spend into November."
  - Risks and actions: "Six budgets are likely to leave USD 13,600.00 unused by year end (16b). Reclaim opens on 16 Nov (86a)."
  - Engagement: "Reach rose to 67.2% of eligible employees (+3.1 points); post-event pulse 4.3 of 5 (15c)."
- Each figure is a link (budget, report or snapshot line); hovering shows the value and source.
- Footer: "AI-drafted from the October snapshot. Edited by Priya Raman." Approve (records approver and freezes the text with the snapshot); "Attach to board pack" (16a).

Variance commentary draft (87a, sample Jordan Lee, Westlake Team Activities, variance +USD 1,800.00, 12%):

- "Draft commentary" fills the field: "Forecast is USD 1,800.00 above authorized because the Thanksgiving event (EVT-2026-0128, USD 4,400.00) was larger than last year's (USD 3,200.00). I plan to cover USD 1,000.00 by releasing the December team lunch reserve and will request the rest." with drivers listed as sources.
- Unknown drivers: the draft inserts "[Explain: no driver found for USD 600.00]" and blocks submission until replaced.
- The owner edits and ticks "This is my explanation" before submitting.

## Data and permissions

New P15 `ai.ts` endpoints: summary drafts from `period_close_snapshots`, `forecast_snapshots`, 16b outlooks, 15b and 15c figures, read with `report.read` in the author's scope; commentary drafts from the owner's budget variance drivers (largest commitments, events and requests behind the variance). Figures are inserted as data references and rendered by BudgetFlow; text containing numbers not in the facts is discarded (11a rule). Summaries are stored with versions (AI draft, edits, approval) and the snapshot id; approved summaries are immutable. Commentary is saved in the 87a forecast snapshot with "drafted with AI" and the suggestion id. Every draft writes an `ai_query_log` row.

## States

| State            | Behaviour                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| AI draft         | warning-tone status "AI draft: not reviewed"; Approve enabled after the author opens every section                |
| Editing          | edited sentences marked "Edited"; Regenerate warns "Replaces your edits in this section"                          |
| Open period      | drafting an open period is allowed only as "Draft (open period)" with figures that may change; cannot be approved |
| Approved         | success tag "Approved by Olivia Grant, 5 Nov"; read-only; "New version" creates an editable copy                  |
| Placeholder left | commentary submit disabled: "Replace the [Explain] note with your explanation"                                    |
| AI off           | "Draft summary" and "Draft commentary" hidden; manual writing unchanged                                           |
| Unavailable      | shared AI banner; editor usable manually                                                                          |
| Loading / error  | `sat-ghost` paragraphs; error banner with Retry                                                                   |

## Budget safety and audit

Summaries quote the company-wide Available by name and the closed-period snapshot, so numbers match the board pack; FX effects are described separately from spend. Drafts never send or publish anything: Export (PDF) and attaching to the board pack happen after a person approves. Approval and commentary submission are audited with the suggestion id, model id and version.

## Responsive and accessibility

Desktop and tablet editing; mobile read-only for approved summaries. Linked figures are real links with the value in the text; edit markers are words, not colour.

## Satori components

`sat-header-bar`, `sat-status-tag` (draft, edited, approved), `sat-tag` (AI), `sat-banner`, `sat-rich-tooltip` (figure source), `sat-ghost`, `satImportantButton` (Approve); Angular Material form fields (rich text limited to paragraphs and lists), dialog (regenerate), snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

016a board pack, 080e period close, 087a forecast cycle, 016 forecast dashboard, 16b spending outlook, 15b participation, 15c outcome linkage, 086a reclaim, 091 scheduled reports, 011a assistant, 113a AI settings.

## Decisions taken

- Leadership summaries are drafted from the closed-period snapshot so they match the board pack; open-period drafts are labelled and cannot be approved. Recommended so a narrative never quotes numbers that later move.
- Every figure is a data reference rendered by BudgetFlow and linked to its source; the model only writes the sentences around them.
- Commentary drafts insert an "[Explain]" placeholder when no driver explains part of a variance, and the owner must replace it; the model never invents reasons.
- Nothing is sent or published automatically; a person approves, then exports or attaches the summary.
