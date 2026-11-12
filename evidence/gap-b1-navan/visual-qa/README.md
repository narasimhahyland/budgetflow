# Gap B1 — visual check

- `092-integrations-hub`: the Navan entry of "Systems you can still add" wrapped to two lines with
  the first copy. Shortened to the length of the other connectors; desktop baselines for default,
  connect-form and read-only updated with `npm run e2e:update-snapshots -- -g 092-integrations-hub`
  in the pinned image (tablet and mobile already matched). Visual baselines updated: Navan connector
  copy on the integrations hub.
- Integrations screens (`092`-`101`, `074a`) re-run after the update: 120 passed; `101-api-keys`
  default and create-form at desktop fail on the seeded key's real-clock expiry date (see the pack
  README).
- New Navan tabs (not in the baseline set: they need a connected Navan) captured at 1440, 834 and
  412 px in `screens/`: Field mapping, Connection, Sync, Push. No horizontal overflow at any width
  (asserted while capturing). One finding fixed: the approvals-boundary list first used the red
  consequence-list style, which reads as a hard block; it is now an info banner.
