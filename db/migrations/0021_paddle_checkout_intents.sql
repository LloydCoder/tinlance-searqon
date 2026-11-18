BEGIN;

CREATE TABLE searqon.billing_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'paddle' CHECK (provider='paddle'),
  plan text NOT NULL CHECK (plan IN ('starter','growth','agency','business','enterprise')),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month','year')),
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating','ready','unknown','failed','completed','expired')),
  provider_transaction_id text UNIQUE
    CHECK (provider_transaction_id IS NULL OR provider_transaction_id ~ '^txn_[a-z0-9]{26}$'),
  checkout_url text
    CHECK (checkout_url IS NULL OR (checkout_url ~ '^https://[^[:space:]]+$' AND length(checkout_url)<=2048)),
  expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,client_request_id),
  CHECK (
    (state='ready' AND provider_transaction_id IS NOT NULL AND checkout_url IS NOT NULL AND expires_at IS NOT NULL)
    OR state<>'ready'
  )
);

CREATE INDEX billing_checkout_intents_org_created_idx
  ON searqon.billing_checkout_intents (organization_id,created_at DESC);
CREATE INDEX billing_checkout_intents_expiry_idx
  ON searqon.billing_checkout_intents (expires_at)
  WHERE state='ready';

ALTER TABLE searqon.billing_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.billing_checkout_intents NO FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_checkout_member_read ON searqon.billing_checkout_intents
  FOR SELECT TO searqon_app
  USING (
    EXISTS (
      SELECT 1 FROM searqon.memberships m
      WHERE m.organization_id=billing_checkout_intents.organization_id
        AND m.user_id=searqon.current_user_id()
        AND m.role IN ('owner','admin')
    )
  );

CREATE POLICY billing_checkout_worker_read ON searqon.billing_checkout_intents
  FOR SELECT TO searqon_billing_worker
  USING (true);
CREATE POLICY billing_checkout_worker_update ON searqon.billing_checkout_intents
  FOR UPDATE TO searqon_billing_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON searqon.billing_checkout_intents TO searqon_app;
GRANT SELECT ON searqon.billing_checkout_intents TO searqon_billing_worker;
GRANT UPDATE (state,updated_at,last_error_code) ON searqon.billing_checkout_intents TO searqon_billing_worker;

CREATE OR REPLACE FUNCTION searqon.create_billing_checkout_intent(
  p_organization_id uuid,
  p_request_id uuid,
  p_plan text,
  p_billing_interval text
)
RETURNS TABLE (
  intent_id uuid,
  intent_state text,
  checkout_url text,
  provider_transaction_id text,
  is_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_role text;
  v_row searqon.billing_checkout_intents%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  IF v_actor IS NULL OR p_organization_id IS NULL OR p_request_id IS NULL
     OR p_plan IS NULL OR p_plan NOT IN ('starter','growth','agency','business','enterprise')
     OR p_billing_interval IS NULL OR p_billing_interval NOT IN ('month','year') THEN
    RAISE EXCEPTION 'Invalid billing checkout intent' USING ERRCODE='22023';
  END IF;

  SELECT m.role INTO v_role
  FROM searqon.memberships m
  WHERE m.organization_id=p_organization_id AND m.user_id=v_actor
  FOR UPDATE;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing administration is not permitted' USING ERRCODE='42501';
  END IF;

  INSERT INTO searqon.billing_checkout_intents
    (organization_id,created_by,client_request_id,plan,billing_interval)
  VALUES
    (p_organization_id,v_actor,p_request_id,p_plan,p_billing_interval)
  ON CONFLICT (organization_id,client_request_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_inserted := true;
    INSERT INTO searqon.audit_events
      (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
    VALUES
      (p_organization_id,v_actor,'billing.checkout.intent_created','billing_checkout_intent',v_row.id::text,
       jsonb_build_object('plan',p_plan,'billing_interval',p_billing_interval,'provider','paddle'));
  ELSE
    SELECT * INTO v_row
    FROM searqon.billing_checkout_intents
    WHERE organization_id=p_organization_id AND client_request_id=p_request_id
    FOR UPDATE;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Billing checkout request could not be recovered' USING ERRCODE='40001';
    END IF;
    IF v_row.plan<>p_plan OR v_row.billing_interval<>p_billing_interval THEN
      RAISE EXCEPTION 'Checkout request ID was reused for a different plan' USING ERRCODE='22023';
    END IF;
  END IF;

  RETURN QUERY SELECT v_row.id,v_row.state,v_row.checkout_url,v_row.provider_transaction_id,v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION searqon.attach_billing_checkout_transaction(
  p_intent_id uuid,
  p_provider_transaction_id text,
  p_checkout_url text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_organization_id uuid;
  v_role text;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM searqon.billing_checkout_intents
  WHERE id=p_intent_id
  FOR UPDATE;
  IF v_organization_id IS NULL THEN RETURN false; END IF;

  SELECT role INTO v_role FROM searqon.memberships
  WHERE organization_id=v_organization_id AND user_id=v_actor;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing administration is not permitted' USING ERRCODE='42501';
  END IF;

  UPDATE searqon.billing_checkout_intents
  SET state='ready',provider_transaction_id=p_provider_transaction_id,
      checkout_url=p_checkout_url,expires_at=p_expires_at,last_error_code=NULL,updated_at=now()
  WHERE id=p_intent_id AND state='creating'
    AND p_provider_transaction_id ~ '^txn_[a-z0-9]{26}$'
    AND p_checkout_url ~ '^https://[^[:space:]]+$'
    AND length(p_checkout_url)<=2048
    AND p_expires_at>now() AND p_expires_at<=now()+interval '1 hour';
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO searqon.audit_events
    (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  VALUES
    (v_organization_id,v_actor,'billing.checkout.ready','billing_checkout_intent',p_intent_id::text,
     jsonb_build_object('provider','paddle','provider_transaction_id',p_provider_transaction_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION searqon.fail_billing_checkout_intent(
  p_intent_id uuid,
  p_state text,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_organization_id uuid;
  v_role text;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('failed','unknown')
     OR p_error_code IS NULL OR p_error_code !~ '^[a-z][a-z0-9_]{0,63}
    RAISE EXCEPTION 'Invalid checkout failure state' USING ERRCODE='22023';
  END IF;
  SELECT organization_id INTO v_organization_id
  FROM searqon.billing_checkout_intents
  WHERE id=p_intent_id
  FOR UPDATE;
  IF v_organization_id IS NULL THEN RETURN false; END IF;
  SELECT role INTO v_role FROM searqon.memberships
  WHERE organization_id=v_organization_id AND user_id=v_actor;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing administration is not permitted' USING ERRCODE='42501';
  END IF;
  UPDATE searqon.billing_checkout_intents
  SET state=p_state,last_error_code=p_error_code,updated_at=now()
  WHERE id=p_intent_id AND state='creating';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION searqon.create_billing_checkout_intent(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.attach_billing_checkout_transaction(uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.fail_billing_checkout_intent(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION searqon.create_billing_checkout_intent(uuid,uuid,text,text) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.attach_billing_checkout_transaction(uuid,text,text,timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.fail_billing_checkout_intent(uuid,text,text) TO searqon_app;

COMMIT;
 THEN
    RAISE EXCEPTION 'Invalid checkout failure state' USING ERRCODE='22023';
  END IF;
  SELECT organization_id INTO v_organization_id
  FROM searqon.billing_checkout_intents
  WHERE id=p_intent_id
  FOR UPDATE;
  IF v_organization_id IS NULL THEN RETURN false; END IF;
  SELECT role INTO v_role FROM searqon.memberships
  WHERE organization_id=v_organization_id AND user_id=v_actor;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Workspace billing administration is not permitted' USING ERRCODE='42501';
  END IF;
  UPDATE searqon.billing_checkout_intents
  SET state=p_state,last_error_code=p_error_code,updated_at=now()
  WHERE id=p_intent_id AND state='creating';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION searqon.create_billing_checkout_intent(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.attach_billing_checkout_transaction(uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.fail_billing_checkout_intent(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION searqon.create_billing_checkout_intent(uuid,uuid,text,text) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.attach_billing_checkout_transaction(uuid,text,text,timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.fail_billing_checkout_intent(uuid,text,text) TO searqon_app;

COMMIT;
