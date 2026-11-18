-- Recommendation ownership and due-date workflow.
-- Existing assigned_to membership constraints are reused; this migration adds only scheduling and audit semantics.
BEGIN;

ALTER TABLE searqon.recommendations
  ADD COLUMN due_date date;

CREATE INDEX recommendations_due_date_idx
  ON searqon.recommendations (organization_id, project_id, due_date, priority DESC)
  WHERE due_date IS NOT NULL AND status NOT IN ('verified','dismissed');

ALTER TABLE searqon.recommendation_events
  DROP CONSTRAINT recommendation_events_event_type_check;

ALTER TABLE searqon.recommendation_events
  ADD CONSTRAINT recommendation_events_event_type_check
  CHECK (event_type IN (
    'created','finding_reobserved','reopened','status_changed',
    'verification_succeeded','verification_failed',
    'assignment_changed','due_date_changed'
  ));

GRANT UPDATE (assigned_to,due_date) ON searqon.recommendations TO searqon_app;

-- Membership RLS intentionally exposes only the current user's own membership.
-- This narrowly-scoped SECURITY DEFINER function returns non-sensitive assignee fields
-- only when the caller is a member of the project tenant.
CREATE OR REPLACE FUNCTION searqon.list_project_members(p_project_id uuid)
RETURNS TABLE(user_id uuid, display_name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, searqon
AS $function$
  SELECT m.user_id, u.display_name, m.role
  FROM searqon.projects p
  JOIN searqon.memberships m ON m.organization_id = p.organization_id
  JOIN searqon.app_users u ON u.id = m.user_id
  WHERE p.id = p_project_id
    AND EXISTS (
      SELECT 1 FROM searqon.memberships actor
      WHERE actor.organization_id = p.organization_id
        AND actor.user_id = searqon.current_user_id()
    )
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
    lower(u.display_name),u.id;
$function$;

REVOKE ALL ON FUNCTION searqon.list_project_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION searqon.list_project_members(uuid) TO searqon_app;

COMMIT;
