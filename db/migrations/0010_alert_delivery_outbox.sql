-- Durable outbox links immutable GEO alert events to encrypted destinations and fenced jobs.
BEGIN;

CREATE TABLE searqon.alert_delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  job_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','failed','cancelled')),
  provider_receipt_id text CHECK (provider_receipt_id IS NULL OR provider_receipt_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_delivery_outbox_event_destination_unique UNIQUE (organization_id,event_id,destination_id),
  CONSTRAINT alert_delivery_outbox_job_unique UNIQUE (job_id),
  CONSTRAINT alert_delivery_outbox_event_fk FOREIGN KEY (event_id,organization_id)
    REFERENCES searqon.geo_alert_events(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT alert_delivery_outbox_destination_fk FOREIGN KEY (destination_id,organization_id)
    REFERENCES searqon.alert_destinations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT alert_delivery_outbox_job_fk FOREIGN KEY (job_id,organization_id)
    REFERENCES searqon.jobs(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT alert_delivery_outbox_terminal_state CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL)
    OR (status <> 'delivered' AND delivered_at IS NULL)
  )
);
CREATE INDEX alert_delivery_outbox_org_status_idx
  ON searqon.alert_delivery_outbox (organization_id,status,created_at DESC);
CREATE INDEX alert_delivery_outbox_job_idx
  ON searqon.alert_delivery_outbox (job_id);

ALTER TABLE searqon.geo_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.geo_alert_events FORCE ROW LEVEL SECURITY;
CREATE POLICY geo_alert_events_worker_read ON searqon.geo_alert_events
  FOR SELECT TO searqon_worker USING (true);

ALTER TABLE searqon.alert_delivery_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.alert_delivery_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY alert_delivery_outbox_member_read ON searqon.alert_delivery_outbox
  FOR SELECT TO searqon_app USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = alert_delivery_outbox.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY alert_delivery_outbox_writer_insert ON searqon.alert_delivery_outbox
  FOR INSERT TO searqon_app WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = alert_delivery_outbox.organization_id
      AND m.user_id = searqon.current_user_id()
      AND m.role IN ('owner','admin','analyst')
  ));
CREATE POLICY alert_delivery_outbox_worker_read ON searqon.alert_delivery_outbox
  FOR SELECT TO searqon_worker USING (true);
CREATE POLICY alert_delivery_outbox_worker_update ON searqon.alert_delivery_outbox
  FOR UPDATE TO searqon_worker USING (true) WITH CHECK (true);

REVOKE ALL PRIVILEGES ON searqon.alert_delivery_outbox FROM PUBLIC,searqon_app,searqon_worker;
GRANT SELECT,INSERT ON searqon.alert_delivery_outbox TO searqon_app;
GRANT SELECT,UPDATE ON searqon.alert_delivery_outbox TO searqon_worker;
GRANT SELECT ON searqon.geo_alert_events TO searqon_worker;

COMMIT;
