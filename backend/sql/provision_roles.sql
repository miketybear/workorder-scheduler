-- Reviewed IT operation after migrations, on a dedicated scheduler database.
-- Precreate distinct owner_role (migration LOGIN) and runtime_role (application LOGIN).
-- IT sets passwords out-of-band. Run psql as database administrator:
-- psql -X -v ON_ERROR_STOP=1 -v owner_role=wos_owner -v runtime_role=wos_runtime -f sql/provision_roles.sql
-- Migrations/tables must already be owned by owner_role; no ownership transfer here.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('wos.owner_role', :'owner_role', true);
SELECT set_config('wos.runtime_role', :'runtime_role', true);
DO $$
DECLARE
    owner_name text := current_setting('wos.owner_role');
    runtime_name text := current_setting('wos.runtime_role');
    runtime_oid oid;
BEGIN
    IF owner_name = runtime_name THEN
        RAISE EXCEPTION 'Migration and runtime roles must differ';
    END IF;
    SELECT oid INTO STRICT runtime_oid FROM pg_roles WHERE rolname = runtime_name;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_name) THEN
        RAISE EXCEPTION 'Migration owner role must exist';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = runtime_oid) THEN
        RAISE EXCEPTION 'Runtime role must not have any role membership';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S')
                 AND pg_get_userbyid(c.relowner) <> owner_name) THEN
        RAISE EXCEPTION 'Public tables/sequences must belong to migration owner';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database()
               AND datdba = runtime_oid) THEN
        RAISE EXCEPTION 'Runtime role must not own database';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = runtime_oid)
       OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = runtime_oid) THEN
        RAISE EXCEPTION 'Runtime role must not own schemas or functions';
    END IF;
    EXECUTE format('ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', runtime_name);
END $$;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), :'runtime_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM :"runtime_role";
GRANT USAGE, CREATE ON SCHEMA public TO :"owner_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, :"runtime_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, :"runtime_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" REVOKE ALL ON TABLES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" REVOKE ALL ON SEQUENCES FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" REVOKE ALL ON FUNCTIONS FROM PUBLIC, :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE ALL ON TABLES FROM :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT INSERT (id, tenant_id, object_id, login_name, display_name, active)
    ON app_user TO :"runtime_role";
GRANT UPDATE (display_name, login_name) ON app_user TO :"runtime_role";
GRANT INSERT, UPDATE, DELETE ON access_grant, planner_permission, user_connection_setting,
    login_session, login_flow, draft, draft_item TO :"runtime_role";
GRANT INSERT ON maximo_person_binding, draft_submission, upload_batch,
    audit_event, authorization_event TO :"runtime_role";
GRANT INSERT, UPDATE ON upload_item TO :"runtime_role";
-- Bootstrap audit inserts and app_user.is_admin changes belong to trusted operators only.
-- No business retention DELETE permission for submissions, uploads or audit history.
COMMIT;
