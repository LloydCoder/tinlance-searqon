-- Durable tenant-scoped usage counters, idempotent reservations and append-only usage events.
-- PostgreSQL 16+. Apply only through the checksum-verifying migration runner.
BEGIN;

CREATE TABLE searqon.usage_period_counters (
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  meter text NOT NULL CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  included_limit bigint NOT NULL CHECK (included_limit >= 0),
  consumed_units bigint NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
  reserved_units bigint NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
  overage_enabled boolean NOT NULL DEFAULT false,
  spend_cap_micro_usd bigint NOT NULL DEFAULT 0 CHECK (spend_cap_micro_usd >= 0),
  overage_spent_micro_usd bigint NOT NULL DEFAULT 0 CHECK (overage_spent_micro_usd >= 0),
  overage_reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (overage_reserved_micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, meter, period_start),
  CONSTRAINT usage_period_bounds CHECK (period_end > period_start),
  CONSTRAINT usage_period_identity UNIQUE (organization_id, meter, period_start, period_end),
  CONSTRAINT usage_period_spend_cap_ceiling CHECK (spend_cap_micro_usd <= 100000000000),
  CONSTRAINT usage_period_overage_policy CHECK (overage_enabled OR spend_cap_micro_usd = 0),
  CONSTRAINT usage_period_meter_ceiling CHECK (
    CASE meter
      WHEN 'ai_answer_checks' THEN included_limit <= 1000000
      WHEN 'crawl_pages' THEN included_limit <= 5000000
      WHEN 'keyword_months' THEN included_limit <= 1000000
      WHEN 'api_requests' THEN included_limit <= 5000000
    END
  ),
  CONSTRAINT usage_period_total_meter_ceiling CHECK (
    CASE meter
      WHEN 'ai_answer_checks' THEN consumed_units + reserved_units <= 1000000
      WHEN 'crawl_pages' THEN consumed_units + reserved_units <= 5000000
      WHEN 'keyword_months' THEN consumed_units + reserved_units <= 1000000
      WHEN 'api_requests' THEN consumed_units + reserved_units <= 5000000
    END
  ),
  CONSTRAINT usage_period_spend_within_cap CHECK (
    overage_spent_micro_usd + overage_reserved_micro_usd <= spend_cap_micro_usd
  ),
  CONSTRAINT usage_period_units_safe CHECK (
    consumed_units <= 9007199254740991
    AND reserved_units <= 9007199254740991
    AND consumed_units + reserved_units <= 9007199254740991
  )
);

CREATE TABLE searqon.usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  meter text NOT NULL CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  requested_units bigint NOT NULL CHECK (requested_units > 0),
  included_reserved_units bigint NOT NULL CHECK (included_reserved_units >= 0),
  overage_reserved_units bigint NOT NULL CHECK (overage_reserved_units >= 0),
  reserved_amount_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_amount_micro_usd >= 0),
  overage_rate_micro_usd_per_block bigint NOT NULL DEFAULT 0 CHECK (overage_rate_micro_usd_per_block >= 0),
  overage_block bigint NOT NULL DEFAULT 1 CHECK (overage_block > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','settled','released')),
  actual_units bigint,
  charged_amount_micro_usd bigint,
  release_reason text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT usage_reservation_period_bounds CHECK (period_end > period_start),
  CONSTRAINT usage_reservation_meter_ceiling CHECK (
    CASE meter
      WHEN 'ai_answer_checks' THEN requested_units <= 1000000
      WHEN 'crawl_pages' THEN requested_units <= 5000000
      WHEN 'keyword_months' THEN requested_units <= 1000000
      WHEN 'api_requests' THEN requested_units <= 5000000
    END
  ),
  CONSTRAINT usage_reservation_amount_ceiling CHECK (reserved_amount_micro_usd <= 100000000000),
  CONSTRAINT usage_reservation_split CHECK (
    included_reserved_units + overage_reserved_units = requested_units
  ),
  CONSTRAINT usage_reservation_terminal_state CHECK (
    (status = 'reserved' AND actual_units IS NULL AND charged_amount_micro_usd IS NULL AND settled_at IS NULL)
    OR (status = 'settled' AND actual_units BETWEEN 0 AND requested_units AND charged_amount_micro_usd >= 0 AND settled_at IS NOT NULL)
    OR (status = 'released' AND actual_units IS NULL AND charged_amount_micro_usd IS NULL AND settled_at IS NOT NULL)
  ),
  CONSTRAINT usage_reservation_counter_fk
    FOREIGN KEY (organization_id, meter, period_start, period_end)
    REFERENCES searqon.usage_period_counters (organization_id, meter, period_start, period_end)
    ON DELETE RESTRICT,
  CONSTRAINT usage_reservation_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT usage_reservation_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX usage_reservations_period_status_idx
  ON searqon.usage_reservations (organization_id, meter, period_start, status, created_at DESC);
CREATE INDEX usage_reservations_expiry_idx
  ON searqon.usage_reservations (organization_id, expires_at)
  WHERE status = 'reserved';

CREATE TABLE searqon.usage_ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL,
  meter text NOT NULL CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests')),
  period_start timestamptz NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('reserved','settled','released')),
  quantity_delta bigint NOT NULL CHECK (quantity_delta >= 0),
  amount_delta_micro_usd bigint NOT NULL CHECK (amount_delta_micro_usd >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_ledger_reservation_fk
    FOREIGN KEY (organization_id, reservation_id)
    REFERENCES searqon.usage_reservations (organization_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX usage_ledger_org_period_idx
  ON searqon.usage_ledger_entries (organization_id, meter, period_start, id);

CREATE OR REPLACE FUNCTION searqon.reject_usage_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'usage ledger entries are append-only' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER usage_ledger_entries_no_update
  BEFORE UPDATE OR DELETE ON searqon.usage_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_usage_ledger_mutation();

ALTER TABLE searqon.usage_period_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.usage_period_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.usage_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.usage_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.usage_ledger_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_period_member_access ON searqon.usage_period_counters
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_period_counters.organization_id
      AND m.user_id = searqon.current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_period_counters.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

CREATE POLICY usage_reservation_member_access ON searqon.usage_reservations
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_reservations.organization_id
      AND m.user_id = searqon.current_user_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_reservations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

CREATE POLICY usage_ledger_member_access ON searqon.usage_ledger_entries
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_ledger_entries.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY usage_ledger_member_insert ON searqon.usage_ledger_entries
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = usage_ledger_entries.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

REVOKE ALL PRIVILEGES ON searqon.usage_period_counters, searqon.usage_reservations, searqon.usage_ledger_entries FROM PUBLIC, searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_usage_ledger_mutation() FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON searqon.usage_period_counters TO searqon_app;
GRANT SELECT, INSERT, UPDATE ON searqon.usage_reservations TO searqon_app;
GRANT SELECT, INSERT ON searqon.usage_ledger_entries TO searqon_app;
GRANT USAGE, SELECT ON SEQUENCE searqon.usage_ledger_entries_id_seq TO searqon_app;

COMMIT;
