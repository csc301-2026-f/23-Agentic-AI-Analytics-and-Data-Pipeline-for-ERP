-- 000: creates the `warehouse` and `app` schemas and the read-only `warehouse_readonly` role.
-- Run as the database owner. Safe to re-run.
-- Does NOT set a password. Set it manually, never in git:
--   ALTER ROLE warehouse_readonly PASSWORD '<strong-password>';

CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS app;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_readonly') THEN
        CREATE ROLE warehouse_readonly LOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
    END IF;
END
$$;
GRANT USAGE ON SCHEMA warehouse TO warehouse_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse TO warehouse_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA warehouse GRANT SELECT ON TABLES TO warehouse_readonly;
REVOKE ALL ON SCHEMA app FROM warehouse_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM warehouse_readonly;

ALTER ROLE warehouse_readonly SET search_path = warehouse;
ALTER ROLE warehouse_readonly SET default_transaction_read_only = on;
ALTER ROLE warehouse_readonly SET statement_timeout = '10s';
ALTER ROLE warehouse_readonly SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE warehouse_readonly CONNECTION LIMIT 5;