#!/usr/bin/env bash
# Counts what the seeded webhook endpoint received, and the budget events that were available to it.
set -euo pipefail
PGUSER_LOCAL=${BF_PG_OWNER_USER:-postgres}
docker exec bf-budget-delegation-and-control-postgres-1 psql -qAt -U "$PGUSER_LOCAL" -d "${BF_PG_DB:-budgetflow}" -c "
  select
    (select count(*) from webhook_deliveries d
       join webhook_endpoints e on e.id = d.endpoint_id
      where e.description like 'Finance hub%')                                as deliveries,
    (select count(*) from outbox_messages
      where topic in ('budget.control_changed','budget.threshold_crossed'))   as budget_events,
    (select count(*) from outbox_messages o
       join webhook_endpoints e on e.description like 'Finance hub%'
      where o.topic in ('budget.control_changed','budget.threshold_crossed')
        and o.created_at < e.created_at)                                      as events_predating_endpoint;
"
