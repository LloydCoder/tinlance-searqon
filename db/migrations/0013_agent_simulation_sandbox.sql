-- Add a dedicated least-privilege queue role and immutable result store for read-only agent simulations.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searqon_agent_worker') THEN
    CREATE ROLE searqon_agent_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE searqon_agent_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT searqon_agent_worker TO searqon_worker;

ALTER TABLE searqon.jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE searqon.jobs
  ADD CONSTRAINT jobs_job_type_check
  CHECK (job_type IN ('assessment','site_crawl','geo_sampling','alert_delivery','scheduled_report','agent_simulation'));

CREATE TABLE searqon.agent_simulation_results (
  job_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (
    jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 65536
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_simulation_results_job_fk
    FOREIGN KEY (job_id,organization_id)
    REFERENCES searqon.jobs(id,organization_id) ON DELETE RESTRICT
);

ALTER TABLE searqon.agent_simulation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.agent_simulation_results FORCE ROW LEVEL SECURITY;

CREATE POLICY jobs_agent_worker_access ON searqon.jobs
  FOR ALL TO searqon_agent_worker
  USING (job_type = 'agent_simulation')
  WITH CHECK (job_type = 'agent_simulation');

CREATE POLICY job_events_agent_worker_read ON searqon.job_events
  FOR SELECT TO searqon_agent_worker
  USING (EXISTS (
    SELECT 1 FROM searqon.jobs j
    WHERE j.id = job_events.job_id
      AND j.organization_id = job_events.organization_id
      AND j.job_type = 'agent_simulation'
  ));

CREATE POLICY job_events_agent_worker_insert ON searqon.job_events
  FOR INSERT TO searqon_agent_worker
  WITH CHECK (
    actor_kind = 'worker'
    AND actor_user_id IS NULL
    AND worker_id = current_setting('searqon.worker_id', true)
    AND EXISTS (
      SELECT 1 FROM searqon.jobs j
      WHERE j.id = job_events.job_id
        AND j.organization_id = job_events.organization_id
        AND j.job_type = 'agent_simulation'
    )
  );

CREATE POLICY agent_simulation_results_member_read ON searqon.agent_simulation_results
  FOR SELECT TO searqon_app
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = agent_simulation_results.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

CREATE POLICY agent_simulation_results_worker_read ON searqon.agent_simulation_results
  FOR SELECT TO searqon_agent_worker
  USING (EXISTS (
    SELECT 1 FROM searqon.jobs j
    WHERE j.id = agent_simulation_results.job_id
      AND j.organization_id = agent_simulation_results.organization_id
      AND j.job_type = 'agent_simulation'
      AND j.status = 'leased'
      AND j.lease_owner = current_setting('searqon.worker_id', true)
      AND j.lease_token = current_setting('searqon.lease_token', true)::uuid
      AND j.lease_expires_at > now()
  ));

CREATE POLICY agent_simulation_results_worker_insert ON searqon.agent_simulation_results
  FOR INSERT TO searqon_agent_worker
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.jobs j
    WHERE j.id = agent_simulation_results.job_id
      AND j.organization_id = agent_simulation_results.organization_id
      AND j.job_type = 'agent_simulation'
      AND j.status = 'leased'
      AND j.lease_owner = current_setting('searqon.worker_id', true)
      AND j.lease_token = current_setting('searqon.lease_token', true)::uuid
      AND j.lease_expires_at > now()
  ));

REVOKE ALL PRIVILEGES ON searqon.agent_simulation_results FROM PUBLIC,searqon_app,searqon_worker,searqon_agent_worker;
GRANT SELECT, INSERT ON searqon.agent_simulation_results TO searqon_agent_worker;
GRANT SELECT ON searqon.agent_simulation_results TO searqon_app;

GRANT SELECT ON searqon.jobs TO searqon_agent_worker;
GRANT UPDATE (status,attempts,scheduled_at,lease_owner,lease_token,lease_expires_at,finished_at,result_sha256,last_error_code,updated_at)
  ON searqon.jobs TO searqon_agent_worker;
GRANT SELECT, INSERT ON searqon.job_events TO searqon_agent_worker;
GRANT USAGE ON SEQUENCE searqon.job_events_id_seq TO searqon_agent_worker;
GRANT USAGE ON SCHEMA searqon TO searqon_agent_worker;

COMMIT;
