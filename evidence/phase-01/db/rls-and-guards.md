# RLS, roles and ledger guards (owner query, 2026-11-04)

## Tenant tables

| tenant_tables | rls_forced | with_policy |
| ------------- | ---------- | ----------- |
| 72            | 72         | 72          |

## Application roles

| rolname   | rolsuper | rolbypassrls |
| --------- | -------- | ------------ |
| bf_app    | false    | false        |
| bf_worker | false    | false        |

## Guard triggers

| trigger                            | on_table               |
| ---------------------------------- | ---------------------- |
| audit_events_append_only           | audit_events           |
| audit_events_no_truncate           | audit_events           |
| budget_versions_append_only        | budget_versions        |
| budget_versions_no_truncate        | budget_versions        |
| ledger_journals_append_only        | ledger_journals        |
| ledger_journals_balanced           | ledger_journals        |
| ledger_journals_no_truncate        | ledger_journals        |
| ledger_journals_open_period        | ledger_journals        |
| ledger_lines_append_only           | ledger_lines           |
| ledger_lines_balanced              | ledger_lines           |
| ledger_lines_no_truncate           | ledger_lines           |
| ledger_lines_open_period           | ledger_lines           |
| period_close_snapshots_append_only | period_close_snapshots |
| period_close_snapshots_no_truncate | period_close_snapshots |
