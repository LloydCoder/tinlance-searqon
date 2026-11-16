-- Passwordless email authentication, server-side sessions and distributed rate limits.
-- The request-serving role receives EXECUTE on narrowly scoped functions, not direct auth-table writes.
BEGIN;

-- The migration/table owner may execute the SECURITY DEFINER provisioning and session lookup
-- functions. Runtime roles are not owners and remain subject to these RLS policies.
ALTER TABLE searqon.app_users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE searqon.sessions NO FORCE ROW LEVEL SECURITY;

CREATE TABLE searqon.auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose = 'magic_login'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_tokens_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT auth_tokens_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX auth_tokens_user_purpose_idx
  ON searqon.auth_tokens (user_id, purpose, created_at DESC);

CREATE TABLE searqon.auth_rate_limits (
  key_hash bytea PRIMARY KEY CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION searqon.register_account(
  p_email text,
  p_display_name text,
  p_organization_name text,
  p_organization_slug text,
  p_token_hash bytea,
  p_token_expires_at timestamptz
)
RETURNS TABLE(user_id uuid, organization_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_user_id uuid;
  v_organization_id uuid;
  v_token_id uuid;
BEGIN
  IF p_email IS NULL OR p_email <> lower(btrim(p_email))
     OR char_length(p_email) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid registration email' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR p_token_expires_at <= now()
     OR p_token_expires_at > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid magic link token parameters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO searqon.app_users (email, display_name)
  VALUES (p_email, p_display_name)
  RETURNING id INTO v_user_id;

  INSERT INTO searqon.organizations (name, slug)
  VALUES (p_organization_name, p_organization_slug)
  RETURNING id INTO v_organization_id;

  INSERT INTO searqon.memberships (organization_id, user_id, role)
  VALUES (v_organization_id, v_user_id, 'owner');

  INSERT INTO searqon.auth_tokens (user_id, token_hash, purpose, expires_at)
  VALUES (v_user_id, p_token_hash, 'magic_login', p_token_expires_at)
  RETURNING id INTO v_token_id;

  PERFORM pg_catalog.set_config('searqon.user_id', v_user_id::text, true);
  INSERT INTO searqon.audit_events (
    organization_id, actor_user_id, event_type, subject_type, subject_id, metadata
  ) VALUES (
    v_organization_id, v_user_id, 'workspace.created', 'organization', v_organization_id::text, '{}'::jsonb
  );
  INSERT INTO searqon.audit_events (
    organization_id, actor_user_id, event_type, subject_type, subject_id, metadata
  ) VALUES (
    v_organization_id, v_user_id, 'auth.magic_link.issued', 'auth_token', v_token_id::text,
    '{"auth_method":"email_magic_link"}'::jsonb
  );

  RETURN QUERY SELECT v_user_id, v_organization_id, v_token_id;
END
$$;

CREATE OR REPLACE FUNCTION searqon.issue_magic_link(
  p_email text,
  p_token_hash bytea,
  p_token_expires_at timestamptz
)
RETURNS TABLE(user_id uuid, token_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_user_id uuid;
  v_token_id uuid;
  v_organization_id uuid;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR p_token_expires_at <= now()
     OR p_token_expires_at > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid magic link token parameters' USING ERRCODE = '22023';
  END IF;

  IF p_email IS NULL OR char_length(btrim(p_email)) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid magic link email' USING ERRCODE = '22023';
  END IF;

  SELECT u.id INTO v_user_id
  FROM searqon.app_users AS u
  WHERE u.email = lower(btrim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE searqon.auth_tokens AS old_token
  SET consumed_at = COALESCE(old_token.consumed_at, now())
  WHERE old_token.user_id = v_user_id
    AND old_token.purpose = 'magic_login'
    AND old_token.consumed_at IS NULL;

  INSERT INTO searqon.auth_tokens (user_id, token_hash, purpose, expires_at)
  VALUES (v_user_id, p_token_hash, 'magic_login', p_token_expires_at)
  RETURNING id INTO v_token_id;

  PERFORM pg_catalog.set_config('searqon.user_id', v_user_id::text, true);
  FOR v_organization_id IN
    SELECT m.organization_id FROM searqon.memberships AS m WHERE m.user_id = v_user_id
  LOOP
    INSERT INTO searqon.audit_events (
      organization_id, actor_user_id, event_type, subject_type, subject_id, metadata
    ) VALUES (
      v_organization_id, v_user_id, 'auth.magic_link.issued', 'auth_token', v_token_id::text,
      '{"auth_method":"email_magic_link"}'::jsonb
    );
  END LOOP;

  RETURN QUERY SELECT v_user_id, v_token_id;
END
$$;

CREATE OR REPLACE FUNCTION searqon.consume_magic_link_and_create_session(
  p_token_hash bytea,
  p_session_hash bytea,
  p_session_expires_at timestamptz
)
RETURNS TABLE(user_id uuid, session_id uuid, session_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
  v_organization_id uuid;
BEGIN
  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR p_session_hash IS NULL OR octet_length(p_session_hash) <> 32
     OR p_session_expires_at <= now()
     OR p_session_expires_at > now() + interval '7 days' THEN
    RAISE EXCEPTION 'invalid session parameters' USING ERRCODE = '22023';
  END IF;

  UPDATE searqon.auth_tokens AS t
  SET consumed_at = now()
  WHERE t.token_hash = p_token_hash
    AND t.purpose = 'magic_login'
    AND t.consumed_at IS NULL
    AND t.expires_at > now()
  RETURNING t.user_id INTO v_user_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE searqon.app_users AS u
  SET email_verified_at = COALESCE(u.email_verified_at, now()),
      updated_at = now()
  WHERE u.id = v_user_id;

  INSERT INTO searqon.sessions (user_id, token_hash, expires_at)
  VALUES (v_user_id, p_session_hash, p_session_expires_at)
  RETURNING id INTO v_session_id;

  PERFORM pg_catalog.set_config('searqon.user_id', v_user_id::text, true);
  FOR v_organization_id IN
    SELECT m.organization_id FROM searqon.memberships AS m WHERE m.user_id = v_user_id
  LOOP
    INSERT INTO searqon.audit_events (
      organization_id, actor_user_id, event_type, subject_type, subject_id, metadata
    ) VALUES (
      v_organization_id, v_user_id, 'auth.session.created', 'session', v_session_id::text,
      '{"auth_method":"email_magic_link"}'::jsonb
    );
  END LOOP;

  RETURN QUERY SELECT v_user_id, v_session_id, p_session_expires_at;
END
$$;

CREATE OR REPLACE FUNCTION searqon.lookup_session(p_session_hash bytea)
RETURNS TABLE(user_id uuid, session_expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, searqon
AS $$
  SELECT s.user_id, s.expires_at
  FROM searqon.sessions AS s
  JOIN searqon.app_users AS u ON u.id = s.user_id
  WHERE s.token_hash = p_session_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.email_verified_at IS NOT NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION searqon.revoke_session(p_session_hash bytea)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_revoked boolean := false;
  v_user_id uuid;
  v_organization_id uuid;
  v_session_id uuid;
BEGIN
  UPDATE searqon.sessions AS s
  SET revoked_at = COALESCE(s.revoked_at, now())
  WHERE s.token_hash = p_session_hash
    AND s.revoked_at IS NULL
  RETURNING s.user_id, s.id INTO v_user_id, v_session_id;
  v_revoked := FOUND;

  IF v_revoked THEN
    PERFORM pg_catalog.set_config('searqon.user_id', v_user_id::text, true);
    FOR v_organization_id IN
      SELECT m.organization_id FROM searqon.memberships AS m WHERE m.user_id = v_user_id
    LOOP
      INSERT INTO searqon.audit_events (
        organization_id, actor_user_id, event_type, subject_type, subject_id, metadata
      ) VALUES (
        v_organization_id, v_user_id, 'auth.session.revoked', 'session', v_session_id::text,
        '{"auth_method":"email_magic_link"}'::jsonb
      );
    END LOOP;
  END IF;

  RETURN v_revoked;
END
$$;

CREATE OR REPLACE FUNCTION searqon.consume_auth_rate_limit(
  p_key_hash bytea,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_attempts integer;
  v_blocked_until timestamptz;
  v_window interval;
BEGIN
  IF p_key_hash IS NULL OR octet_length(p_key_hash) <> 32
     OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds < 60 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit parameters' USING ERRCODE = '22023';
  END IF;

  v_window := make_interval(secs => p_window_seconds);

  INSERT INTO searqon.auth_rate_limits AS current_bucket
    (key_hash, window_started_at, attempts, blocked_until)
  VALUES (p_key_hash, now(), 1, NULL)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN current_bucket.window_started_at + v_window <= now() THEN now()
      ELSE current_bucket.window_started_at
    END,
    attempts = CASE
      WHEN current_bucket.window_started_at + v_window <= now() THEN 1
      ELSE current_bucket.attempts + 1
    END,
    blocked_until = CASE
      WHEN current_bucket.window_started_at + v_window <= now() THEN NULL
      WHEN current_bucket.attempts + 1 > p_limit THEN now() + v_window
      ELSE current_bucket.blocked_until
    END,
    updated_at = now()
  RETURNING attempts, blocked_until INTO v_attempts, v_blocked_until;

  RETURN v_attempts <= p_limit AND (v_blocked_until IS NULL OR v_blocked_until <= now());
END
$$;

REVOKE ALL ON TABLE searqon.auth_tokens, searqon.auth_rate_limits FROM PUBLIC, searqon_app;
REVOKE ALL ON FUNCTION searqon.register_account(text, text, text, text, bytea, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.issue_magic_link(text, bytea, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.consume_magic_link_and_create_session(bytea, bytea, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.lookup_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.revoke_session(bytea) FROM PUBLIC;
CREATE OR REPLACE FUNCTION searqon.consume_auth_email_rate_limit(p_key_hash bytea)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $
  SELECT searqon.consume_auth_rate_limit(p_key_hash, 5, 900)
$;

CREATE OR REPLACE FUNCTION searqon.consume_auth_ip_rate_limit(p_key_hash bytea)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $
  SELECT searqon.consume_auth_rate_limit(p_key_hash, 10, 900)
$;

REVOKE ALL ON FUNCTION searqon.consume_auth_rate_limit(bytea, integer, integer) FROM PUBLIC, searqon_app;
REVOKE ALL ON FUNCTION searqon.consume_auth_email_rate_limit(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.consume_auth_ip_rate_limit(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION searqon.consume_auth_email_rate_limit(bytea) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.consume_auth_ip_rate_limit(bytea) TO searqon_app;

GRANT EXECUTE ON FUNCTION searqon.register_account(text, text, text, text, bytea, timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.issue_magic_link(text, bytea, timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.consume_magic_link_and_create_session(bytea, bytea, timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.lookup_session(bytea) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.revoke_session(bytea) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.consume_auth_rate_limit(bytea, integer, integer) TO searqon_app;