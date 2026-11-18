-- Dedicated, least-privilege identities for verified billing event ingestion and processing.
-- No request-serving role receives access to this inbox.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searqon_billing_ingest') THEN
    CREATE ROLE searqon_billing_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searqon_billing_worker') THEN
    CREATE ROLE searqon_billing_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE searqon_billing_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE searqon_billing_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

ALTER TABLE searqon.billing_webhook_inbox
  ADD COLUMN provider_created_at timestamptz;
UPDATE searqon.billing_webhook_inbox SET provider_created_at=verified_at WHERE provider_created_at IS NULL;
ALTER TABLE searqon.billing_webhook_inbox ALTER COLUMN provider_created_at SET NOT NULL;

ALTER TABLE searqon.billing_webhook_inbox
  ADD COLUMN lease_owner text CHECK (lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$'),
  ADD COLUMN lease_token uuid,
  ADD COLUMN max_attempts smallint NOT NULL DEFAULT 12 CHECK (max_attempts BETWEEN 1 AND 100);

ALTER TABLE searqon.billing_webhook_inbox
  DROP CONSTRAINT billing_webhook_lease_state;
ALTER TABLE searqon.billing_webhook_inbox
  ADD CONSTRAINT billing_webhook_lease_state CHECK (
    (processing_status = 'processing' AND locked_until IS NOT NULL AND lease_owner IS NOT NULL AND lease_token IS NOT NULL)
    OR (processing_status <> 'processing' AND locked_until IS NULL AND lease_owner IS NULL AND lease_token IS NULL)
  );

CREATE POLICY billing_webhook_ingest_insert ON searqon.billing_webhook_inbox
  FOR INSERT TO searqon_billing_ingest
  WITH CHECK (true);
CREATE POLICY billing_webhook_ingest_duplicate_read ON searqon.billing_webhook_inbox
  FOR SELECT TO searqon_billing_ingest
  USING (true);
CREATE POLICY billing_webhook_worker_select ON searqon.billing_webhook_inbox
  FOR SELECT TO searqon_billing_worker
  USING (true);
CREATE POLICY billing_webhook_worker_update ON searqon.billing_webhook_inbox
  FOR UPDATE TO searqon_billing_worker
  USING (true)
  WITH CHECK (true);

CREATE POLICY billing_worker_subscription_access ON searqon.subscriptions
  FOR ALL TO searqon_billing_worker
  USING (true)
  WITH CHECK (true);
CREATE POLICY billing_worker_subscription_event_read ON searqon.subscription_events
  FOR SELECT TO searqon_billing_worker
  USING (true);
CREATE POLICY billing_worker_subscription_event_insert ON searqon.subscription_events
  FOR INSERT TO searqon_billing_worker
  WITH CHECK (true);

GRANT USAGE ON SCHEMA searqon TO searqon_billing_ingest, searqon_billing_worker;
GRANT INSERT (provider,provider_event_id,organization_id,event_type,event_kind,raw_body_sha256,verified_at,provider_created_at,received_at,normalized_payload)
  ON searqon.billing_webhook_inbox TO searqon_billing_ingest;
GRANT SELECT (id,provider,provider_event_id,organization_id,raw_body_sha256,provider_created_at)
  ON searqon.billing_webhook_inbox TO searqon_billing_ingest;
GRANT SELECT ON searqon.billing_webhook_inbox TO searqon_billing_worker;
GRANT UPDATE (processing_status,attempt_count,next_attempt_at,locked_until,lease_owner,lease_token,processed_at,last_error_code,updated_at)
  ON searqon.billing_webhook_inbox TO searqon_billing_worker;
GRANT SELECT,INSERT,UPDATE ON searqon.subscriptions TO searqon_billing_worker;
GRANT SELECT,INSERT ON searqon.subscription_events TO searqon_billing_worker;

COMMIT;
