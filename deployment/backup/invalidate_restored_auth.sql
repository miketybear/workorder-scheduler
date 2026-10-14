-- Only on a newly restored, isolated DB before ingress is opened.
-- psql -X -v ON_ERROR_STOP=1 -v expected_database=wos_restore_<12hex>
--      -v restore_case=DR-<approved-ticket> -f invalidate_restored_auth.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
SELECT set_config('wos.restore_database', :'expected_database', true);
SELECT set_config('wos.restore_case', :'restore_case', true);
DO $$
BEGIN
    IF current_database() <> current_setting('wos.restore_database')
       OR current_database() !~ '^wos_restore_[0-9a-f]{12}$'
       OR current_setting('wos.restore_case') !~ '^DR-[A-Za-z0-9-]{1,60}$' THEN
        RAISE EXCEPTION 'Refusing auth invalidation outside an identified isolated restore';
    END IF;
END $$;
WITH removed_flows AS (DELETE FROM public.login_flow RETURNING 1),
     removed_sessions AS (DELETE FROM public.login_session RETURNING 1)
SELECT (SELECT count(*) FROM removed_flows) AS invalidated_login_flows,
       (SELECT count(*) FROM removed_sessions) AS invalidated_login_sessions;
COMMIT;
