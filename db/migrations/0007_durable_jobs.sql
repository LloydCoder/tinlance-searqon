-- Durable tenant-scoped job queue with fenced worker leases and append-only events.
-- Workers receive a separate least-privilege role; the request runtime cannot claim or mutate jobs.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searqon_worker') THEN
    CREATE ROLE searqon_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE searqon_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

CREATE TABLE searqon.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN ('assessment','site_crawl','geo_sampling','alert_delivery','scheduled_report')),
  payload_version smallint NOT NULL DEFAULT 1 CHECK (payload_version BETWEEN 1 AND 100),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 16384
  ),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','succeeded','failed','cancelled')),
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text CHECK (lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  result_sha256 text CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[a-f0-9]{64}$'),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT jobs_org_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT jobs_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT jobs_attempt_bounds CHECK (attempts <= max_attempts),
  CONSTRAINT jobs_lease_state CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND finished_at IS NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT jobs_terminal_state CHECK (
    (status IN ('succeeded','failed','cancelled') AND finished_at IS NOT NULL)
    OR (status IN ('queued','leased') AND finished_at IS NULL)
  ),
  CONSTRAINT jobs_result_state CHECK (status <> 'succeeded' OR result_sha256 IS NOT NULL)
);
CREATE INDEX jobs_ready_idx
  ON searqon.jobs (priority DESC, scheduled_at, created_at)
  WHERE status = 'queued';
CREATE INDEX jobs_expired_lease_idx
  ON searqon.jobs (lease_expires_at)
  WHERE status = 'leased';
CREATE INDEX jobs_org_recent_idx
  ON searqon.jobs (organization_id, created_at DESC, id DESC);

CREATE TABLE searqon.job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('queued','leased','retry_scheduled','succeeded','failed','cancelled','lease_expired','lease_extended')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','worker')),
  actor_user_id uuid REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  worker_id text CHECK (worker_id IS NULL OR worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$'),
  attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 20),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_events_job_tenant_fk FOREIGN KEY (job_id, organization_id)
    REFERENCES searqon.jobs(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT job_events_actor_consistency CHECK (
    (actor_kind = 'user' AND actor_user_id IS NOT NULL AND worker_id IS NULL)
    OR (actor_kind = 'worker' AND actor_user_id IS NULL AND worker_id IS NOT NULL)
  )
);
CREATE INDEX job_events_job_idx ON searqon.job_events (job_id, id);
CREATE INDEX job_events_org_idx ON searqon.job_events (organization_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION searqon.protect_job_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $
BEGIN
  IF ROW(NEW.id,NEW.organization_id,NEW.created_by,NEW.job_type,NEW.payload_version,NEW.payload,
         NEW.payload_sha256,NEW.max_attempts,NEW.idempotency_key,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.organization_id,OLD.created_by,OLD.job_type,OLD.payload_version,OLD.payload,
         OLD.payload_sha256,OLD.max_attempts,OLD.idempotency_key,OLD.created_at) THEN
    RAISE EXCEPTION 'job identity and payload are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('succeeded','failed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal jobs cannot transition' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN
    RAISE EXCEPTION 'job attempt count must be monotonic and increment by at most one' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$;
CREATE TRIGGER jobs_protect_identity
  BEFORE UPDATE ON searqon.jobs
  FOR EACH ROW EXECUTE FUNCTION searqon.protect_job_identity();

CREATE OR REPLACE FUNCTION searqon.reject_job_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'job events are append-only' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER job_events_no_update
  BEFORE UPDATE OR DELETE ON searqon.job_events
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_job_event_mutation();

ALTER TABLE searqon.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.job_events FORCE ROW LEVEL SECURITY;

CREATE POLICY jobs_member_read ON searqon.jobs
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = jobs.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY jobs_writer_insert ON searqon.jobs
  FOR INSERT WITH CHECK (
    created_by = searqon.current_user_id()
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = jobs.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );
CREATE POLICY jobs_worker_access ON searqon.jobs
  FOR ALL TO searqon_worker USING (true) WITH CHECK (true);

CREATE POLICY job_events_member_read ON searqon.job_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = job_events.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY job_events_user_insert ON searqon.job_events
  FOR INSERT WITH CHECK (
    actor_kind = 'user'
    AND actor_user_id = searqon.current_user_id()
    AND worker_id IS NULL
    AND EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id = job_events.organization_id
        AND m.user_id = searqon.current_user_id()
        AND m.role IN ('owner','admin','analyst')
    )
  );
CREATE POLICY job_events_worker_access ON searqon.job_events
  FOR SELECT TO searqon_worker USING (true);
CREATE POLICY job_events_worker_insert ON searqon.job_events
  FOR INSERT TO searqon_worker WITH CHECK (
    actor_kind = 'worker' AND actor_user_id IS NULL AND worker_id = current_setting('searqon.worker_id', true)
  );

REVOKE ALL PRIVILEGES ON searqon.jobs, searqon.job_events FROM PUBLIC, searqon_app, searqon_worker;
REVOKE ALL ON FUNCTION searqon.reject_job_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.protect_job_identity() FROM PUBLIC;
GRANT SELECT, INSERT ON searqon.jobs TO searqon_app;
GRANT SELECT, INSERT ON searqon.job_events TO searqon_app;
GRANT SELECT, UPDATE ON searqon.jobs TO searqon_worker;
GRANT SELECT, INSERT ON searqon.job_events TO searqon_worker;
GRANT USAGE ON SCHEMA searqon TO searqon_worker;

COMMIT;
