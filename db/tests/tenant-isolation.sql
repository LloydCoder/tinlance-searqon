\set ON_ERROR_STOP on
BEGIN;

INSERT INTO searqon.app_users (id, email, display_name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'member-a@example.test', 'Member A'),
  ('10000000-0000-4000-8000-000000000002', 'member-b@example.test', 'Member B');
INSERT INTO searqon.organizations (id, name, slug) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Workspace A', 'workspace-a'),
  ('20000000-0000-4000-8000-000000000002', 'Workspace B', 'workspace-b');
INSERT INTO searqon.memberships (organization_id, user_id, role) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');
INSERT INTO searqon.projects (id, organization_id, name, target_url, created_by) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Project A', 'https://a.example.test', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Project B', 'https://b.example.test', '10000000-0000-4000-8000-000000000002');
INSERT INTO searqon.assessments (id, organization_id, project_id, requested_by, assessment_type, methodology_version)
VALUES ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'seo', '1.0.0');
INSERT INTO searqon.audit_events (organization_id, actor_user_id, event_type, subject_type, subject_id)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'project.created', 'project', '30000000-0000-4000-8000-000000000001');

DO $body$
DECLARE role_state record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit
    INTO role_state FROM pg_roles WHERE rolname = 'searqon_app';
  IF role_state.rolcanlogin OR role_state.rolsuper OR role_state.rolcreatedb
     OR role_state.rolcreaterole OR role_state.rolbypassrls OR role_state.rolinherit THEN
    RAISE EXCEPTION 'application database role has an unsafe role attribute';
  END IF;
END
$body$;

DO $body$
BEGIN
  IF has_table_privilege('searqon_app', 'searqon.audit_events', 'UPDATE') THEN
    RAISE EXCEPTION 'application role must not be granted audit UPDATE';
  END IF;
  IF has_table_privilege('searqon_app', 'searqon.audit_events', 'DELETE') THEN
    RAISE EXCEPTION 'application role must not be granted audit DELETE';
  END IF;
END
$body$;
-- Temporarily grant UPDATE and an RLS policy only inside this rolled-back test
-- so the trigger is independently exercised even if privileges are misconfigured.
GRANT UPDATE ON searqon.audit_events TO searqon_app;
CREATE POLICY audit_events_update_test ON searqon.audit_events
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = audit_events.organization_id AND m.user_id = searqon.current_user_id()
  ));

SET LOCAL ROLE searqon_app;
SET LOCAL searqon.user_id = '10000000-0000-4000-8000-000000000001';

DO $$
DECLARE visible_projects integer;
DECLARE visible_assessments integer;
DECLARE visible_workspaces integer;
BEGIN
  SELECT count(*) INTO visible_projects FROM searqon.projects;
  SELECT count(*) INTO visible_assessments FROM searqon.assessments;
  SELECT count(*) INTO visible_workspaces FROM searqon.organizations;
  IF visible_projects <> 1 THEN RAISE EXCEPTION 'expected one visible project, got %', visible_projects; END IF;
  IF visible_assessments <> 1 THEN RAISE EXCEPTION 'expected one visible assessment, got %', visible_assessments; END IF;
  IF visible_workspaces <> 1 THEN RAISE EXCEPTION 'expected one visible workspace, got %', visible_workspaces; END IF;
  IF (SELECT count(*) FROM searqon.app_users) <> 1 THEN RAISE EXCEPTION 'user profile policy leaked another user'; END IF;
  IF (SELECT count(*) FROM searqon.audit_events) <> 1 THEN RAISE EXCEPTION 'audit event visibility is incorrect'; END IF;
END
$$;

-- A member cannot create or move a project into an organization they do not belong to.
DO $$
BEGIN
  BEGIN
    INSERT INTO searqon.projects (organization_id, name, target_url, created_by)
    VALUES ('20000000-0000-4000-8000-000000000002', 'Cross-tenant', 'https://x.example.test',
      '10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'cross-tenant project insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Authorized writes are attributed to the authenticated actor.
INSERT INTO searqon.projects (organization_id, name, target_url, created_by)
VALUES ('20000000-0000-4000-8000-000000000001', 'Member project', 'https://member.example.test',
  '10000000-0000-4000-8000-000000000001');
INSERT INTO searqon.assessments (organization_id, project_id, requested_by, assessment_type, methodology_version)
VALUES ('20000000-0000-4000-8000-000000000001',
  (SELECT id FROM searqon.projects WHERE name = 'Member project'),
  '10000000-0000-4000-8000-000000000001', 'aeo', '1.0.0');

-- Audit records are append-only even for a tenant member.
DO $body$
BEGIN
  BEGIN
    UPDATE searqon.audit_events SET subject_id = 'tampered'
    WHERE subject_id = '30000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'audit event update unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
END
$body$;

-- A request without authenticated user context sees no tenant-scoped records.
SET LOCAL searqon.user_id = '';
DO $$
BEGIN
  IF (SELECT count(*) FROM searqon.projects) <> 0 THEN RAISE EXCEPTION 'missing identity context exposed projects'; END IF;
  IF (SELECT count(*) FROM searqon.organizations) <> 0 THEN RAISE EXCEPTION 'missing identity context exposed organizations'; END IF;
END
$$;

ROLLBACK;
