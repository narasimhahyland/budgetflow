#!/usr/bin/env bash
# What the delivery log holds: rows per status and attempt, and whether any row is still pending.
# A fanned-out delivery is one row, so total_rows should exceed distinct_events only by the
# redeliveries an operator asked for.
set -euo pipefail
container=${BF_PG_CONTAINER:-bf-p12-fix-postgres-1}
docker exec "$container" psql -qA -U "${BF_PG_OWNER_USER:-bf_owner}" -d "${BF_PG_DB:-budgetflow}" \
  -c "select d.status, d.attempt, count(*) as rows
        from webhook_deliveries d group by 1, 2 order by 1, 2;" \
  -c "select count(*) filter (where status = 'pending') as stale_pending,
             count(*)                                   as total_rows,
             count(distinct (endpoint_id, event_id))    as distinct_events
        from webhook_deliveries;"
