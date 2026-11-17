-- Durable, evidence-linked recommendation workflow with explicit human state transitions.
-- Verification requires a later, comparable successful assessment.
BEGIN;

ALTER TABLE searqon.assessments
  ADD CONSTRAINT assessments_org_project_id_unique UNIQUE (organization_id, project_id, id);

CREATE TABLE searqon.recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_assessment_id uuid NOT NULL,
  latest_assessment_id uuid NOT NULL,
  verification_assessment_id uuid,
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  finding_key text NOT NULL CHECK (finding_key ~ '^[a-f0-9]{64}$'),
  rule_id text NOT NULL CHECK (rule_id ~ '^[a-z][a-z0-9_.-]{1,159}$'),
  dimension text NOT NULL CHECK (dimension IN ('SEO','AEO','GEO','AgEO')),
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  priority smallint NOT NULL CHECK (priority BETWEEN 0 AND 100),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
  recommended_action text NOT NULL CHECK (char_length(recommended_action) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','accepted','in_progress','dismissed','verified','not_resolved')),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count BETWEEN 1 AND 1000000),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  verification_result jsonb CHECK (verification_result IS NULL OR jsonb_typeof(verification_result) = 'object'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendations_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES searqon.projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_source_assessment_fk
    FOREIGN KEY (organization_id, project_id, source_assessment_id)
    REFERENCES searqon.assessments (organization_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_latest_assessment_fk
    FOREIGN KEY (organization_id, project_id, latest_assessment_id)
    REFERENCES searqon.assessments (organization_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_verification_assessment_fk
    FOREIGN KEY (organization_id, project_id, verification_assessment_id)
    REFERENCES searqon.assessments (organization_id, project_id, id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_assignment_member_fk
    FOREIGN KEY (organization_id, assigned_to)
    REFERENCES searqon.memberships (organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT recommendations_verification_state CHECK (
    (status = 'verified' AND verification_assessment_id IS NOT NULL AND verified_at IS NOT NULL
      AND verification_result->>'result' = 'finding_absent')
    OR (status = 'not_resolved' AND verification_assessment_id IS NOT NULL AND verified_at IS NULL
      AND verification_result->>'result' = 'finding_present')
    OR (status NOT IN ('verified','not_resolved') AND verification_assessment_id IS NULL
      AND verified_at IS NULL AND verification_result IS NULL)
  ),
  CONSTRAINT recommendations_source_latest_distinct CHECK (
    verification_assessment_id IS NULL OR verification_assessment_id <> latest_assessment_id
  ),
  CONSTRAINT recommendations_org_project_key_unique UNIQUE (organization_id, project_id, finding_key),
  CONSTRAINT recommendations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT recommendations_org_id_project_unique UNIQUE (organization_id, id, project_id)
);
CREATE INDEX recommendations_project_status_idx
  ON searqon.recommendations (organization_id, project_id, status, priority DESC, updated_at DESC);
CREATE INDEX recommendations_assignee_idx
  ON searqon.recommendations (organization_id, assigned_to, status)
  WHERE assigned_to IS NOT NULL;

CREATE TABLE searqon.recommendation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  recommendation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created','finding_reobserved','reopened','status_changed',
    'verification_succeeded','verification_failed'
  )),
  from_status text CHECK (from_status IS NULL OR from_status IN ('open','accepted','in_progress','dismissed','verified','not_resolved')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('open','accepted','in_progress','dismissed','verified','not_resolved')),
  assessment_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_events_recommendation_fk
    FOREIGN KEY (organization_id, recommendation_id, project_id)
    REFERENCES searqon.recommendations (organization_id, id, project_id) ON DELETE RESTRICT,
  CONSTRAINT recommendation_events_assessment_fk
    FOREIGN KEY (organization_id, project_id, assessment_id)
    REFERENCES searqon.assessments (organization_id, project_id, id) ON DELETE RESTRICT
);
CREATE INDEX recommendation_events_history_idx
  ON searqon.recommendation_events (organization_id, recommendation_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION searqon.reject_recommendation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'recommendation events are append-only' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER recommendation_events_no_update
  BEFORE UPDATE OR DELETE ON searqon.recommendation_events
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_recommendation_event_mutation();

ALTER TABLE searqon.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.recommendations FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.recommendation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.recommendation_events FORCE ROW LEVEL SECURITY;

CREATE POLICY recommendations_member_select ON searqon.recommendations
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = recommendations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY recommendations_writer_insert ON searqon.recommendations
  FOR INSERT WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = recommendations.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
    AND (assigned_to IS NULL OR EXISTS (
      SELECT 1 FROM searqon.memberships a
      WHERE a.organization_id = recommendations.organization_id AND a.user_id = recommendations.assigned_to
    ))
  );
CREATE POLICY recommendations_writer_update ON searqon.recommendations
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = recommendations.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  ))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = recommendations.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
    AND (assigned_to IS NULL OR EXISTS (
      SELECT 1 FROM searqon.memberships a
      WHERE a.organization_id = recommendations.organization_id AND a.user_id = recommendations.assigned_to
    ))
  );
CREATE POLICY recommendation_events_member_select ON searqon.recommendation_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = recommendation_events.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY recommendation_events_writer_insert ON searqon.recommendation_events
  FOR INSERT WITH CHECK (
    actor_user_id = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = recommendation_events.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

REVOKE ALL PRIVILEGES ON searqon.recommendations, searqon.recommendation_events FROM PUBLIC, searqon_app;
REVOKE ALL PRIVILEGES ON SEQUENCE searqon.recommendation_events_id_seq FROM PUBLIC, searqon_app;
GRANT SELECT, INSERT ON searqon.recommendations TO searqon_app;
GRANT UPDATE (assigned_to,status,latest_assessment_id,occurrence_count,last_seen_at,
  verification_assessment_id,verification_result,verified_at,updated_at)
  ON searqon.recommendations TO searqon_app;
GRANT SELECT, INSERT ON searqon.recommendation_events TO searqon_app;
GRANT USAGE, SELECT ON SEQUENCE searqon.recommendation_events_id_seq TO searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_recommendation_event_mutation() FROM PUBLIC;

COMMIT;
