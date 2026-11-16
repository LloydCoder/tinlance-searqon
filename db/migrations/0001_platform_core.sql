-- Searqon hosted platform foundation.
-- PostgreSQL 16+. Apply once through the migration runner; never edit an applied migration.
BEGIN;

CREATE SCHEMA IF NOT EXISTS searqon;

CREATE OR REPLACE FUNCTION searqon.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('searqon.user_id', true), '')::uuid
$$;

CREATE TABLE searqon.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT app_users_email_length CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT app_users_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX app_users_email_unique ON searqon.app_users (email);

CREATE TABLE searqon.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
);
CREATE UNIQUE INDEX organizations_slug_unique ON searqon.organizations (slug);

CREATE TABLE searqon.memberships (
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_org_idx ON searqon.memberships (user_id, organization_id);

CREATE TABLE searqon.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  target_url text NOT NULL,
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT projects_target_url_length CHECK (char_length(target_url) BETWEEN 1 AND 2048),
  CONSTRAINT projects_org_id_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX projects_org_created_idx ON searqon.projects (organization_id, created_at DESC);

CREATE TABLE searqon.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  assessment_type text NOT NULL CHECK (assessment_type IN ('seo', 'aeo', 'geo', 'ageo', 'combined')),
  methodology_version text NOT NULL,
  report jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT assessments_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES searqon.projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT assessments_report_object CHECK (report IS NULL OR jsonb_typeof(report) = 'object'),
  CONSTRAINT assessments_error_code_length CHECK (error_code IS NULL OR char_length(error_code) <= 128)
);
CREATE INDEX assessments_org_project_created_idx
  ON searqon.assessments (organization_id, project_id, created_at DESC);
CREATE INDEX assessments_queue_idx ON searqon.assessments (created_at)
  WHERE status = 'queued';

CREATE TABLE searqon.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_expiry_idx ON searqon.sessions (user_id, expires_at);

CREATE TABLE searqon.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  subject_type text NOT NULL CHECK (char_length(subject_type) BETWEEN 1 AND 80),
  subject_id text NOT NULL CHECK (char_length(subject_id) BETWEEN 1 AND 160),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time_idx ON searqon.audit_events (organization_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION searqon.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON searqon.audit_events
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_audit_event_mutation();

ALTER TABLE searqon.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.app_users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_read_self ON searqon.app_users
  FOR SELECT USING (id = searqon.current_user_id());
CREATE POLICY organizations_member_read ON searqon.organizations
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = organizations.id AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY memberships_self_read ON searqon.memberships
  FOR SELECT USING (user_id = searqon.current_user_id());
CREATE POLICY projects_member_access ON searqon.projects
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = projects.organization_id AND m.user_id = searqon.current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = projects.organization_id AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY assessments_member_access ON searqon.assessments
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = assessments.organization_id AND m.user_id = searqon.current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = assessments.organization_id AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY sessions_self_access ON searqon.sessions
  FOR ALL USING (user_id = searqon.current_user_id())
  WITH CHECK (user_id = searqon.current_user_id());
CREATE POLICY audit_events_member_read ON searqon.audit_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = audit_events.organization_id AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY audit_events_member_insert ON searqon.audit_events
  FOR INSERT WITH CHECK (
    actor_user_id = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = audit_events.organization_id AND m.user_id = searqon.current_user_id()
    )
  );

-- The runtime role is deliberately not granted membership administration or user provisioning.
-- Provisioning/invitation flows will be exposed only through narrowly scoped server-side functions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searqon_app') THEN
    CREATE ROLE searqon_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA searqon TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.current_user_id() TO searqon_app;
GRANT SELECT ON searqon.app_users, searqon.organizations, searqon.memberships TO searqon_app;
GRANT SELECT, INSERT, UPDATE ON searqon.projects, searqon.assessments TO searqon_app;
GRANT SELECT, INSERT, UPDATE ON searqon.sessions TO searqon_app;
GRANT SELECT, INSERT ON searqon.audit_events TO searqon_app;
GRANT USAGE, SELECT ON SEQUENCE searqon.audit_events_id_seq TO searqon_app;

COMMIT;
