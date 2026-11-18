-- Immutable, tenant-scoped remediation-plan proposals linked to recommendations and evidence.
BEGIN;

CREATE TABLE searqon.recommendation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_ref text NOT NULL CHECK (plan_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  plan_digest char(64) NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('ready_for_human_review','blocked_by_test_evidence')),
  plan_document jsonb NOT NULL CHECK (jsonb_typeof(plan_document) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_plans_project_fk
    FOREIGN KEY (organization_id,project_id)
    REFERENCES searqon.projects (organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT recommendation_plans_creator_fk
    FOREIGN KEY (organization_id,created_by)
    REFERENCES searqon.memberships (organization_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT recommendation_plans_ref_unique UNIQUE (organization_id,project_id,plan_ref),
  CONSTRAINT recommendation_plans_org_project_id_unique UNIQUE (organization_id,project_id,id)
);

CREATE INDEX recommendation_plans_project_created_idx
  ON searqon.recommendation_plans (organization_id,project_id,created_at DESC,id DESC);

ALTER TABLE searqon.recommendation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.recommendation_plans FORCE ROW LEVEL SECURITY;

CREATE POLICY recommendation_plans_member_read ON searqon.recommendation_plans
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = recommendation_plans.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

CREATE POLICY recommendation_plans_writer_insert ON searqon.recommendation_plans
  FOR INSERT WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = recommendation_plans.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

CREATE OR REPLACE FUNCTION searqon.reject_recommendation_plan_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'recommendation plans are immutable' USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION searqon.reject_recommendation_plan_mutation() FROM PUBLIC;
CREATE TRIGGER recommendation_plans_no_update_delete
  BEFORE UPDATE OR DELETE ON searqon.recommendation_plans
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_recommendation_plan_mutation();

REVOKE ALL ON searqon.recommendation_plans FROM PUBLIC,searqon_app;
GRANT SELECT,INSERT ON searqon.recommendation_plans TO searqon_app;

COMMIT;
