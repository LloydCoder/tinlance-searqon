-- Persist supplied GEO aggregate snapshots, alert events and cooldown state.
-- No provider collection or outbound delivery is enabled by this migration.
BEGIN;

CREATE TABLE searqon.geo_alert_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  captured_at timestamptz NOT NULL,
  cohort_count integer NOT NULL CHECK (cohort_count BETWEEN 0 AND 2000),
  snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot) = 'array'
    AND octet_length(snapshot::text) <= 4194304
  ),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_alert_snapshots_org_id_unique UNIQUE (organization_id,snapshot_id),
  CONSTRAINT geo_alert_snapshots_id_org_unique UNIQUE (id,organization_id)
);
CREATE INDEX geo_alert_snapshots_org_time_idx
  ON searqon.geo_alert_snapshots (organization_id,captured_at DESC,created_at DESC);

CREATE TABLE searqon.geo_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  alert_id text NOT NULL CHECK (alert_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  alert_type text NOT NULL CHECK (alert_type IN ('mention_change','brand_citation_change')),
  metric text NOT NULL CHECK (metric IN ('mention','brand_citation')),
  direction text NOT NULL CHECK (direction IN ('decline','increase')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high')),
  baseline_snapshot_id text NOT NULL,
  current_snapshot_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('emitted','suppressed')),
  suppressed_until timestamptz,
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 65536
  ),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_alert_events_org_event_unique UNIQUE (organization_id,event_id),
  CONSTRAINT geo_alert_events_org_alert_unique UNIQUE (organization_id,alert_id),
  CONSTRAINT geo_alert_events_id_org_unique UNIQUE (id,organization_id),
  CONSTRAINT geo_alert_events_baseline_fk FOREIGN KEY (organization_id,baseline_snapshot_id)
    REFERENCES searqon.geo_alert_snapshots(organization_id,snapshot_id) ON DELETE RESTRICT,
  CONSTRAINT geo_alert_events_current_fk FOREIGN KEY (organization_id,current_snapshot_id)
    REFERENCES searqon.geo_alert_snapshots(organization_id,snapshot_id) ON DELETE RESTRICT,
  CONSTRAINT geo_alert_events_suppression_state CHECK (
    (state = 'suppressed' AND suppressed_until IS NOT NULL)
    OR (state = 'emitted' AND suppressed_until IS NULL)
  )
);
CREATE INDEX geo_alert_events_org_time_idx
  ON searqon.geo_alert_events (organization_id,created_at DESC,id DESC);
CREATE INDEX geo_alert_events_org_dedupe_idx
  ON searqon.geo_alert_events (organization_id,dedupe_key,created_at DESC);

CREATE TABLE searqon.geo_alert_cooldowns (
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  last_emitted_event_id uuid NOT NULL,
  last_emitted_at timestamptz NOT NULL,
  cooldown_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,dedupe_key),
  CONSTRAINT geo_alert_cooldowns_event_fk FOREIGN KEY (last_emitted_event_id,organization_id)
    REFERENCES searqon.geo_alert_events(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT geo_alert_cooldowns_time_order CHECK (cooldown_until >= last_emitted_at)
);
CREATE INDEX geo_alert_cooldowns_expiry_idx
  ON searqon.geo_alert_cooldowns (cooldown_until);

CREATE OR REPLACE FUNCTION searqon.reject_geo_alert_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $geo_alert_guard$
BEGIN
  RAISE EXCEPTION 'GEO alert snapshots and events are append-only' USING ERRCODE = '55000';
END
$geo_alert_guard$;
CREATE TRIGGER geo_alert_snapshots_no_update
  BEFORE UPDATE OR DELETE ON searqon.geo_alert_snapshots
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_geo_alert_immutable_mutation();
CREATE TRIGGER geo_alert_events_no_update
  BEFORE UPDATE OR DELETE ON searqon.geo_alert_events
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_geo_alert_immutable_mutation();

ALTER TABLE searqon.geo_alert_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_events FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_cooldowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_cooldowns FORCE ROW LEVEL SECURITY;

CREATE POLICY geo_alert_snapshots_member_read ON searqon.geo_alert_snapshots
  FOR SELECT TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_snapshots.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY geo_alert_snapshots_writer_insert ON searqon.geo_alert_snapshots
  FOR INSERT TO searqon_app WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = geo_alert_snapshots.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

CREATE POLICY geo_alert_events_member_read ON searqon.geo_alert_events
  FOR SELECT TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_events.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY geo_alert_events_writer_insert ON searqon.geo_alert_events
  FOR INSERT TO searqon_app WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = geo_alert_events.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );

CREATE POLICY geo_alert_cooldowns_member_read ON searqon.geo_alert_cooldowns
  FOR SELECT TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_cooldowns.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY geo_alert_cooldowns_writer_insert ON searqon.geo_alert_cooldowns
  FOR INSERT TO searqon_app WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_cooldowns.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  ));
CREATE POLICY geo_alert_cooldowns_writer_update ON searqon.geo_alert_cooldowns
  FOR UPDATE TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_cooldowns.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = geo_alert_cooldowns.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  ));

REVOKE ALL PRIVILEGES ON searqon.geo_alert_snapshots,searqon.geo_alert_events,searqon.geo_alert_cooldowns FROM PUBLIC,searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_geo_alert_immutable_mutation() FROM PUBLIC;
GRANT SELECT,INSERT ON searqon.geo_alert_snapshots,searqon.geo_alert_events TO searqon_app;
GRANT SELECT,INSERT,UPDATE ON searqon.geo_alert_cooldowns TO searqon_app;

COMMIT;
