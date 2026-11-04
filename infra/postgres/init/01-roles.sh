#!/bin/sh
# Runs once when the Postgres volume is created. POSTGRES_USER (bf_owner) owns the schema and runs
# migrations; the application roles log in with dev-only passwords and never bypass RLS.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE bf_app LOGIN NOBYPASSRLS PASSWORD '${BF_PG_APP_PASSWORD}';
CREATE ROLE bf_worker LOGIN NOBYPASSRLS PASSWORD '${BF_PG_WORKER_PASSWORD}';
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO bf_app, bf_worker;
EOSQL
