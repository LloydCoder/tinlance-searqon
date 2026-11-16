-- Enforce a 30-minute inactivity timeout while retaining the 24-hour absolute session lifetime.
-- last_seen_at is advanced only by the trusted server-side session lookup function.
BEGIN;

CREATE OR REPLACE FUNCTION searqon.lookup_session(p_session_hash bytea)
RETURNS TABLE(user_id uuid, session_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_user_id uuid;
  v_session_expires_at timestamptz;
BEGIN
  IF p_session_hash IS NULL OR octet_length(p_session_hash) <> 32 THEN
    RETURN;
  END IF;

  UPDATE searqon.sessions AS s
  SET last_seen_at = now()
  FROM searqon.app_users AS u
  WHERE s.user_id = u.id
    AND s.token_hash = p_session_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND COALESCE(s.last_seen_at, s.created_at) > now() - interval '30 minutes'
    AND u.email_verified_at IS NOT NULL
  RETURNING s.user_id, s.expires_at
  INTO v_user_id, v_session_expires_at;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_user_id, v_session_expires_at;
END
$$;

REVOKE ALL ON FUNCTION searqon.lookup_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION searqon.lookup_session(bytea) TO searqon_app;

COMMIT;
