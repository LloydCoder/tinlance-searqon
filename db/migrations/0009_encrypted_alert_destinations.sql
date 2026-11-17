-- Store alert destination credentials as tenant-bound AES-256-GCM ciphertext.
-- The request runtime can write encrypted credentials but cannot read ciphertext back.
BEGIN;

CREATE TABLE searqon.alert_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('slack','teams','pagerduty')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  secret_ciphertext bytea NOT NULL CHECK (octet_length(secret_ciphertext) BETWEEN 1 AND 2048),
  secret_nonce bytea NOT NULL CHECK (octet_length(secret_nonce) = 12),
  secret_tag bytea NOT NULL CHECK (octet_length(secret_tag) = 16),
  key_version text NOT NULL CHECK (key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  secret_sha256 text NOT NULL CHECK (secret_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_destinations_id_org_unique UNIQUE (id,organization_id)
);
CREATE INDEX alert_destinations_org_recent_idx
  ON searqon.alert_destinations (organization_id,created_at DESC,id DESC);
CREATE INDEX alert_destinations_enabled_idx
  ON searqon.alert_destinations (organization_id,channel)
  WHERE status = 'enabled';

ALTER TABLE searqon.alert_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.alert_destinations FORCE ROW LEVEL SECURITY;

CREATE POLICY alert_destinations_member_read ON searqon.alert_destinations
  FOR SELECT TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = alert_destinations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY alert_destinations_writer_insert ON searqon.alert_destinations
  FOR INSERT TO searqon_app WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = alert_destinations.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );
CREATE POLICY alert_destinations_writer_update ON searqon.alert_destinations
  FOR UPDATE TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = alert_destinations.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = alert_destinations.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  ));
CREATE POLICY alert_destinations_worker_read ON searqon.alert_destinations
  FOR SELECT TO searqon_worker USING (true);

REVOKE ALL PRIVILEGES ON searqon.alert_destinations FROM PUBLIC,searqon_app,searqon_worker;
GRANT SELECT (id,organization_id,channel,display_name,status,created_at,updated_at,last_verified_at)
  ON searqon.alert_destinations TO searqon_app;
GRANT INSERT (id,organization_id,created_by,channel,display_name,secret_ciphertext,secret_nonce,secret_tag,key_version,secret_sha256,status)
  ON searqon.alert_destinations TO searqon_app;
GRANT UPDATE (status,updated_at)
  ON searqon.alert_destinations TO searqon_app;
GRANT SELECT ON searqon.alert_destinations TO searqon_worker;

COMMIT;
