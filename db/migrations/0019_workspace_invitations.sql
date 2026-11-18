-- Tenant-scoped workspace invitations and role administration.
-- Invitation tokens are one-time, hashed at rest and accepted only by the verified invited email.
BEGIN;

CREATE TABLE searqon.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES searqon.organizations(id) ON DELETE RESTRICT,
  invited_email text NOT NULL CHECK (invited_email = lower(btrim(invited_email)) AND char_length(invited_email) BETWEEN 3 AND 320),
  invited_role text NOT NULL CHECK (invited_role IN ('admin','analyst','viewer')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  invited_by uuid NOT NULL REFERENCES searqon.app_users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_invitation_terminal_state CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CONSTRAINT workspace_invitation_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX workspace_invitation_pending_email_unique
  ON searqon.workspace_invitations (organization_id, invited_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_org_recent_idx
  ON searqon.workspace_invitations (organization_id, created_at DESC, id DESC);

ALTER TABLE searqon.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE searqon.workspace_invitations NO FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitations_member_read ON searqon.workspace_invitations
  FOR SELECT TO searqon_app
  USING (EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = workspace_invitations.organization_id
      AND m.user_id = searqon.current_user_id()
  ));

CREATE OR REPLACE FUNCTION searqon.create_workspace_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_token_hash bytea,
  p_expires_at timestamptz
)
RETURNS TABLE(invitation_id uuid, expires_at timestamptz, invited_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_actor_role text;
  v_invitation_id uuid;
BEGIN
  IF v_actor IS NULL OR p_organization_id IS NULL
     OR p_email IS NULL OR p_email <> lower(btrim(p_email))
     OR char_length(p_email) NOT BETWEEN 3 AND 320
     OR p_role NOT IN ('admin','analyst','viewer')
     OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR p_expires_at <= now() OR p_expires_at > now() + interval '7 days' THEN
    RAISE EXCEPTION 'invalid workspace invitation parameters' USING ERRCODE = '22023';
  END IF;

  SELECT m.role INTO v_actor_role
  FROM searqon.memberships m
  WHERE m.organization_id = p_organization_id AND m.user_id = v_actor
  FOR UPDATE;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'workspace administrator role required' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'admin' AND v_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'only workspace owners may invite administrators' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM searqon.app_users u
    JOIN searqon.memberships m ON m.user_id = u.id
    WHERE u.email = p_email AND m.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'user is already a workspace member' USING ERRCODE = '23505';
  END IF;

  UPDATE searqon.workspace_invitations
  SET revoked_at = now()
  WHERE organization_id = p_organization_id AND invited_email = p_email
    AND accepted_at IS NULL AND revoked_at IS NULL;

  INSERT INTO searqon.workspace_invitations
    (organization_id,invited_email,invited_role,token_hash,invited_by,expires_at)
  VALUES (p_organization_id,p_email,p_role,p_token_hash,p_expires_at)
  RETURNING id INTO v_invitation_id;

  INSERT INTO searqon.audit_events
    (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  VALUES
    (p_organization_id,v_actor,'workspace.invitation.created','invitation',v_invitation_id::text,
     jsonb_build_object('role',p_role));

  RETURN QUERY SELECT v_invitation_id,p_expires_at,p_role;
END
$$;

CREATE OR REPLACE FUNCTION searqon.accept_workspace_invitation(p_token_hash bytea)
RETURNS TABLE(organization_id uuid, member_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_email text;
  v_invitation searqon.workspace_invitations%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'authenticated user and invitation token are required' USING ERRCODE = '22023';
  END IF;
  SELECT u.email INTO v_email
  FROM searqon.app_users u
  WHERE u.id = v_actor AND u.email_verified_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'verified email is required to accept an invitation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invitation
  FROM searqon.workspace_invitations i
  WHERE i.token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND OR v_invitation.accepted_at IS NOT NULL OR v_invitation.revoked_at IS NOT NULL
     OR v_invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation is invalid or expired' USING ERRCODE = '22023';
  END IF;
  IF v_invitation.invited_email <> v_email THEN
    RAISE EXCEPTION 'invitation email does not match the verified account' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id = v_invitation.organization_id AND m.user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'user is already a workspace member' USING ERRCODE = '23505';
  END IF;

  INSERT INTO searqon.memberships (organization_id,user_id,role)
  VALUES (v_invitation.organization_id,v_actor,v_invitation.invited_role);
  UPDATE searqon.workspace_invitations SET accepted_at=now() WHERE id=v_invitation.id;
  INSERT INTO searqon.audit_events
    (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  VALUES
    (v_invitation.organization_id,v_actor,'workspace.invitation.accepted','invitation',v_invitation.id::text,
     jsonb_build_object('role',v_invitation.invited_role));

  RETURN QUERY SELECT v_invitation.organization_id,v_invitation.invited_role;
END
$$;

CREATE OR REPLACE FUNCTION searqon.revoke_workspace_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_actor_role text;
  v_invitation searqon.workspace_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation
  FROM searqon.workspace_invitations
  WHERE id=p_invitation_id
  FOR UPDATE;
  IF NOT FOUND OR v_invitation.accepted_at IS NOT NULL OR v_invitation.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT role INTO v_actor_role FROM searqon.memberships
  WHERE organization_id=v_invitation.organization_id AND user_id=v_actor;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner','admin')
     OR (v_actor_role='admin' AND v_invitation.invited_role='admin') THEN
    RAISE EXCEPTION 'workspace administrator role required' USING ERRCODE = '42501';
  END IF;
  UPDATE searqon.workspace_invitations SET revoked_at=now() WHERE id=p_invitation_id;
  INSERT INTO searqon.audit_events
    (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  VALUES
    (v_invitation.organization_id,v_actor,'workspace.invitation.revoked','invitation',p_invitation_id::text,'{}'::jsonb);
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION searqon.set_workspace_member_role(
  p_organization_id uuid,
  p_member_user_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $$
DECLARE
  v_actor uuid := searqon.current_user_id();
  v_actor_role text;
  v_target_role text;
BEGIN
  IF p_role NOT IN ('admin','analyst','viewer') OR p_member_user_id IS NULL
     OR p_member_user_id = v_actor THEN
    RAISE EXCEPTION 'invalid workspace role change' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_actor_role FROM searqon.memberships
  WHERE organization_id=p_organization_id AND user_id=v_actor
  FOR UPDATE;
  SELECT role INTO v_target_role FROM searqon.memberships
  WHERE organization_id=p_organization_id AND user_id=p_member_user_id
  FOR UPDATE;
  IF v_actor_role IS NULL OR v_target_role IS NULL OR v_actor_role NOT IN ('owner','admin')
     OR (v_actor_role='admin' AND (p_role='admin' OR v_target_role IN ('owner','admin'))) THEN
    RAISE EXCEPTION 'workspace role change is not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_target_role='owner' AND (
    SELECT count(*) FROM searqon.memberships
    WHERE organization_id=p_organization_id AND role='owner'
  ) <= 1 THEN
    RAISE EXCEPTION 'a workspace must retain at least one owner' USING ERRCODE = '23514';
  END IF;
  UPDATE searqon.memberships SET role=p_role
  WHERE organization_id=p_organization_id AND user_id=p_member_user_id;
  INSERT INTO searqon.audit_events
    (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata)
  VALUES
    (p_organization_id,v_actor,'workspace.member.role_changed','membership',p_member_user_id::text,
     jsonb_build_object('previous_role',v_target_role,'new_role',p_role));
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION searqon.list_workspace_members(p_organization_id uuid)
RETURNS TABLE(user_id uuid,email text,display_name text,role text,joined_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, searqon
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM searqon.memberships m
    WHERE m.organization_id=p_organization_id AND m.user_id=searqon.current_user_id()
  ) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.id,u.email,u.display_name,m.role,m.created_at
  FROM searqon.memberships m
  JOIN searqon.app_users u ON u.id=m.user_id
  WHERE m.organization_id=p_organization_id
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,u.display_name,u.id;
END
$$;

REVOKE ALL ON searqon.workspace_invitations FROM PUBLIC,searqon_app;
GRANT SELECT ON searqon.workspace_invitations TO searqon_app;
REVOKE ALL ON FUNCTION searqon.create_workspace_invitation(uuid,text,text,bytea,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.accept_workspace_invitation(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.revoke_workspace_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.set_workspace_member_role(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION searqon.list_workspace_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION searqon.create_workspace_invitation(uuid,text,text,bytea,timestamptz) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.accept_workspace_invitation(bytea) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.revoke_workspace_invitation(uuid) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.set_workspace_member_role(uuid,uuid,text) TO searqon_app;
GRANT EXECUTE ON FUNCTION searqon.list_workspace_members(uuid) TO searqon_app;

COMMIT;
