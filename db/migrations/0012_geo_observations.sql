-- Persist caller-supplied GEO observations with immutable provenance and quota-backed ingestion.
BEGIN;

CREATE TABLE searqon.geo_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  submitted_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  provider_name text NOT NULL CHECK (char_length(provider_name) BETWEEN 1 AND 128),
  observation_class text NOT NULL CHECK (observation_class IN ('consumer_observation','model_api')),
  sampled_at timestamptz NOT NULL,
  brand text NOT NULL CHECK (char_length(brand) BETWEEN 1 AND 128),
  target_domain text,
  mentioned boolean NOT NULL,
  mention_count integer NOT NULL CHECK (mention_count >= 0),
  citation_count integer NOT NULL CHECK (citation_count BETWEEN 0 AND 100),
  brand_cited boolean NOT NULL,
  normalized_observation jsonb NOT NULL
    CHECK (jsonb_typeof(normalized_observation) = 'object' AND octet_length(normalized_observation::text) <= 524288),
  raw_payload jsonb NOT NULL
    CHECK (jsonb_typeof(raw_payload) = 'object' AND octet_length(raw_payload::text) <= 2097152),
  source_payload_hash text NOT NULL CHECK (source_payload_hash ~ '^[a-f0-9]{64}$'),
  evidence_id text NOT NULL CHECK (evidence_id ~ '^evidence_[a-f0-9]{20}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_bytes integer NOT NULL CHECK (evidence_bytes BETWEEN 1 AND 2097152),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_observations_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES searqon.projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT geo_observations_org_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT geo_observations_project_evidence_unique UNIQUE (organization_id, project_id, evidence_id),
  CONSTRAINT geo_observations_org_project_id_unique UNIQUE (organization_id, project_id, id)
);
CREATE INDEX geo_observations_project_sampled_idx
  ON searqon.geo_observations (organization_id, project_id, sampled_at DESC, id DESC);
CREATE INDEX geo_observations_provider_class_idx
  ON searqon.geo_observations (organization_id, project_id, provider_name, observation_class, sampled_at DESC);

CREATE OR REPLACE FUNCTION searqon.reject_geo_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'GEO observations are immutable evidence records' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER geo_observations_no_update
  BEFORE UPDATE OR DELETE ON searqon.geo_observations
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_geo_observation_mutation();

ALTER TABLE searqon.geo_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY geo_observations_member_select ON searqon.geo_observations
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_observations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY geo_observations_writer_insert ON searqon.geo_observations
  FOR INSERT WITH CHECK (
    submitted_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = geo_observations.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

REVOKE ALL PRIVILEGES ON searqon.geo_observations FROM PUBLIC, searqon_app;
GRANT SELECT, INSERT ON searqon.geo_observations TO searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_geo_observation_mutation() FROM PUBLIC;

COMMIT;
),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_bytes integer NOT NULL CHECK (evidence_bytes BETWEEN 1 AND 2097152),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_observations_project_tenant_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES searqon.projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT geo_observations_org_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT geo_observations_org_project_id_unique UNIQUE (organization_id, project_id, id)
);
CREATE INDEX geo_observations_project_sampled_idx
  ON searqon.geo_observations (organization_id, project_id, sampled_at DESC, id DESC);
CREATE INDEX geo_observations_provider_class_idx
  ON searqon.geo_observations (organization_id, project_id, provider_name, observation_class, sampled_at DESC);

CREATE OR REPLACE FUNCTION searqon.reject_geo_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'GEO observations are immutable evidence records' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER geo_observations_no_update
  BEFORE UPDATE OR DELETE ON searqon.geo_observations
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_geo_observation_mutation();

ALTER TABLE searqon.geo_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY geo_observations_member_select ON searqon.geo_observations
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_observations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY geo_observations_writer_insert ON searqon.geo_observations
  FOR INSERT WITH CHECK (
    submitted_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = geo_observations.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

REVOKE ALL PRIVILEGES ON searqon.geo_observations FROM PUBLIC, searqon_app;
GRANT SELECT, INSERT ON searqon.geo_observations TO searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_geo_observation_mutation() FROM PUBLIC;

COMMIT;
