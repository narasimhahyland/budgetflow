# Navan integration: what the public documentation offers

Research for Phase 16a of the build plan. Sources are Navan's public integrations page and developer
portal (`developer.navan.com`), read on 2026-11-11. Nothing here comes from a customer account or an
internal source, and no call was made against a live Navan tenant. Re-check the portal before building:
the Expense API is versioned and its release notes name endpoints that are not yet documented.

## What exists

| Surface             | What it does                                                                                                   | Use in BudgetFlow                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Expense API (REST)  | Read transactions of every type, receipts, users, audit logs; write GL code, HR fields and custom-field values | Inbound actuals; outbound coding and event-code options      |
| Custom fields API   | Define fields and create, update or delete their options in async batch jobs (up to 5,000 operations)          | Publish event codes and cost centers; disable on control     |
| Booking API         | Booking data for downstream systems (named on the integrations page, not documented in detail)                 | Travel commitments, once access is confirmed                 |
| MCP server (hosted) | Lets an AI assistant work with Navan under the signed-in user's own role; cannot bypass approval or policy     | Not a dependency; sits beside the BudgetFlow MCP connector   |
| Native integrations | ERP and accounting, HRIS, SSO and SCIM, Slack, calendars, card networks, expense tools                         | Navan keeps feeding the ERP; BudgetFlow reads the same spend |

## Expense API facts that shape the design

- Base `https://api.navan.com/v1/expense`; EU tenants add a region header or calls fail.
- OAuth 2.0 client credentials, tokens last about 12 hours. Credentials are read-only unless the
  Expense: Write scope is granted; sending a `scope` parameter on the token call can strip it.
- Transactions are fetched by type (`card-transactions`, `connect-transactions`, `manual-transactions`,
  `repayments`, `fees`, `adjustments`, `daily-rebates`, `disputes`, `statement-payments`) or through a generic
  `transactions` endpoint with bulk id lookup. At least one date filter is required and a range is capped at 93 days.
- Cursor pagination, 1 to 500 per page. No rate-limit numbers are published; 429 means back off.
- Batch `PATCH /transactions` updates up to 100 at a time: GL code, HR fields (department, region,
  subsidiary, cost center), custom-field values, and ERP sync status (only to synced).
- Receipts come as presigned links valid for 7 days.
- Results can lag updates by up to four hours. Date filters reach back to the first day of the month two months ago.
- Users, audit logs and activities are for eligible companies (a 403 means asking the Navan account team).

## What is not documented

- **Webhooks.** The developer portal mentions them; no events or signing scheme are published. Polling is the baseline.
- **Budgets and pre-approval.** No endpoint lets an outside system approve, reject or gate a trip or expense before the
  traveler books. Navan approvers work inside Navan. A budget check at approval time needs a conversation with Navan.
- **Access terms.** Whether credentials are self-service or need a partner agreement is not stated.

## Design consequences

1. Spend flows in by polling modified-date windows; the sync is incremental and idempotent.
2. The control that always works is on the outbound side: BudgetFlow owns the event-code and cost-center option lists in
   Navan, so a frozen, zeroed, exhausted or closed budget stops being selectable. Whether options can be deactivated or
   only deleted is an open question.
3. Approval stays split. Navan approves the individual trip or expense; BudgetFlow keeps delegation-of-authority limits,
   co-funding and freeze, and puts over-budget spend into its exception queue.
4. The current Phase 12 Navan adapter is a mock on placeholder paths. Phase 16a rebuilds it on the real paths and shapes.
