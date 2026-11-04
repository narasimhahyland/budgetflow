## Problem

<!-- What is missing or wrong, and which plan phase (P1-P20) and screen numbers this serves. -->

## Change

<!-- What changed and why this approach. Mention any shared-file, contract or migration change explicitly. -->

## Screens

<!-- UI changes: embed key screenshots and link the visual QA report (evidence/<id>/visual-qa/report.md). Delete if none. -->

## Visual baselines

<!--
Only when files under **/__screenshots__/** change. CI fails the PR if baselines change without this line.
Regenerate only with `npm run e2e:update-snapshots` (pinned Playwright image), never by hand.
-->

Visual baselines updated: <!-- reason, e.g. "screen 005 allocation grid: new soft-warning banner (approved Stitch v3)" -->

## Verification

<!-- Paste the scripts/gate.sh summary table and the /functional-check outcome table (scenario, role, expected, actual, result). -->

```text
scripts/gate.sh <mode>
```

## Risks and follow-ups

<!-- Known issues, open UX questions, anything a reviewer should look at first. -->

## Checklist

- [ ] Scope: only files this change owns; shared-file changes called out above
- [ ] `/functional-check` passed: API scenarios and/or journeys prove the business outcome as the relevant roles; evidence linked
- [ ] Invariants touched are mapped to passing scenarios in `docs/testing/invariant-scenarios.md`
- [ ] `scripts/gate.sh` passes (all modes); no skipped or weakened checks
- [ ] UI changes: `/visual-qa` finished with no blocking issues; report linked above
- [ ] Satori components and `--mat-sys-*` / `--sat-sys-*` tokens only; no other UI kits
- [ ] Copy is plain English; money via the shared money component and Angular formatters
- [ ] Money in integer minor units; ledger postings balanced and append-only; audit entries intact
- [ ] No secrets, tokens, internal URLs or internal names (public repo)
