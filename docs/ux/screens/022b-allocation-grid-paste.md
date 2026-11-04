# 022b Allocation grid with paste from Excel

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State                           | Image                                                                        | Stitch screen                      |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| paste-preview (2 cells blocked) | `design/stitch/022b-allocation-grid-paste/paste-preview--desktop--light.png` | `0c8b687d0dcd472da148c243a20157fe` |

## Purpose

Change many child allocations at once, keyboard-first, by pasting from a spreadsheet, then submit everything as one change.

## Roles

Owners of the parent (here Arjun Mehta, India Region) and Finance Admin.

## Entry points

022 allocation workspace "Import from Excel" or "Grid view"; 023 row menu.

## Content and actions

Header with "Available under this budget's rules" (tooltip). Toolbar: Paste from Excel, Import file, undo/redo, keyboard hint. Info banner after paste. Grid: row number, Child budget, Owner, Current, New, Change, Driver, Check; new rows tagged; per-head rows locked ("Driven by headcount"); focused cell outlined. Sticky footer: total change against available with a bar, "Fix 2 cells to submit", Discard paste, Save draft, Submit as one change.

## Data and permissions

`budget:allocate` on the parent. Paste is parsed client-side and validated server-side (dry run). Submit sends one change set with an idempotency key; ledger posts under ordered row locks.

## States

| State        | Behaviour                                                                  |
| ------------ | -------------------------------------------------------------------------- |
| Cell errors  | red cell outline with message in Check (owner required, below committed)   |
| Over parent  | footer turns error tone "Exceeds available by USD …"; submit disabled      |
| Soft warning | parent above an alert threshold after submit: warning line, submit allowed |
| Success      | snackbar; changes over the DoA limit go to approval as one request         |

## Budget safety and audit

A child cannot go below its committed + actual + children; the total cannot exceed the parent's available. One change set, one journal, one audit entry listing every line.

## Responsive and accessibility

Desktop only for editing (tablet read-only). `role="grid"` with arrow-key navigation, Enter to edit, Escape to cancel; errors announced and linked to cells.

## Related screens and navigation

022, 022a, 023, 024, 059.

## Assumptions and open questions

- New child budgets created by paste start as Draft until an owner is set; confirm.
