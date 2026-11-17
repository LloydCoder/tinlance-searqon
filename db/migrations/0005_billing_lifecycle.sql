-- Durable subscription source of truth and verified, redacted billing webhook inbox.
-- Provider signature verification happens before inbox insertion in a dedicated adapter.
-- Raw webhook bodies and payment credentials are never persisted here.
BEGIN;

CREATE TABLE searqon.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  provider_customer_id text,
  provider_subscription_id text,
  status text NOT NULL CHECK (status IN ('active','trialing','past_due','canceled','expired','free')),
  plan text NOT NULL CHECK (plan IN ('free','starter','growth','agency','business','enterprise','trial')),
  billing_interval text NOT NULL DEFAULT 'none' CHECK (billing_interval IN ('none','month','year')),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  provider_event_created_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_period_bounds CHECK (current_period_end > current_period_start),
  CONSTRAINT subscriptions_provider_ids CHECK (
    (provider_customer_id IS NULL OR provider_customer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$')
    AND (provider_subscription_id IS NULL OR provider_subscription_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$')
  ),
  CONSTRAINT subscriptions_provider_pair CHECK (
    (provider_customer_id IS NULL) = (provider_subscription_id IS NULL)
  ),
  CONSTRAINT subscriptions_trial_consistency CHECK (
    (status = 'trialing' AND plan = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at > current_period_start)
    OR (status <> 'trialing' AND plan <> 'trial' AND trial_ends_at IS NULL)
  ),
  CONSTRAINT subscriptions_free_consistency CHECK (
    (status = 'free' AND plan = 'free' AND billing_interval = 'none')
    OR status <> 'free'
  ),
  CONSTRAINT subscriptions_trial_interval CHECK (
    status <> 'trialing' OR billing_interval = 'none'
  )
);
CREATE UNIQUE INDEX subscriptions_provider_customer_unique
  ON searqon.subscriptions (provider, provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_provider_subscription_unique
  ON searqon.subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX subscriptions_status_period_idx
  ON searqon.subscriptions (status, current_period_end);

CREATE TABLE searqon.billing_webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  provider_event_id text NOT NULL CHECK (provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed'
  )),
  event_kind text NOT NULL CHECK (event_kind IN ('subscription.snapshot','invoice.payment_succeeded','invoice.payment_failed')),
  raw_body_sha256 text NOT NULL CHECK (raw_body_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  normalized_payload jsonb NOT NULL CHECK (
    jsonb_typeof(normalized_payload) = 'object'
    AND octet_length(normalized_payload::text) <= 16384
  ),
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processing','processed','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  processed_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_webhook_event_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT billing_webhook_processing_state CHECK (
    (processing_status = 'processed' AND processed_at IS NOT NULL AND locked_until IS NULL)
    OR (processing_status <> 'processed' AND processed_at IS NULL)
  ),
  CONSTRAINT billing_webhook_lease_state CHECK (
    (processing_status = 'processing' AND locked_until IS NOT NULL)
    OR (processing_status <> 'processing' AND locked_until IS NULL)
  )
);
CREATE INDEX billing_webhook_dispatch_idx
  ON searqon.billing_webhook_inbox (next_attempt_at, created_at)
  WHERE processing_status IN ('pending','failed');
CREATE INDEX billing_webhook_lease_idx
  ON searqon.billing_webhook_inbox (locked_until)
  WHERE processing_status = 'processing';

CREATE TABLE searqon.subscription_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  provider_event_id text NOT NULL CHECK (provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 128),
  previous_snapshot jsonb CHECK (previous_snapshot IS NULL OR jsonb_typeof(previous_snapshot) = 'object'),
  resulting_snapshot jsonb NOT NULL CHECK (jsonb_typeof(resulting_snapshot) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_events_provider_event_unique UNIQUE (provider, provider_event_id)
);
CREATE INDEX subscription_events_org_time_idx
  ON searqon.subscription_events (organization_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION searqon.reject_subscription_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'subscription events are append-only' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER subscription_events_no_update
  BEFORE UPDATE OR DELETE ON searqon.subscription_events
  FOR EACH ROW EXECUTE FUNCTION searqon.reject_subscription_event_mutation();

ALTER TABLE searqon.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.billing_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.billing_webhook_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.subscription_events FORCE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_member_read ON searqon.subscriptions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = subscriptions.organization_id
      AND m.user_id = searqon.current_user_id()
  ));
CREATE POLICY subscription_events_member_read ON searqon.subscription_events
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = subscription_events.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

-- The application runtime may inspect a workspace's current plan, but cannot
-- mutate subscriptions or read/claim/complete the privileged webhook inbox.
-- A future billing worker must use a separate least-privilege identity.
REVOKE ALL PRIVILEGES ON searqon.subscriptions, searqon.billing_webhook_inbox, searqon.subscription_events FROM PUBLIC, searqon_app;
GRANT SELECT ON searqon.subscriptions, searqon.subscription_events TO searqon_app;
REVOKE ALL ON FUNCTION searqon.reject_subscription_event_mutation() FROM PUBLIC;

COMMIT;
