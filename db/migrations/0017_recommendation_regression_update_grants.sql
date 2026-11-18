-- Permit the recommendation service to refresh descriptive/severity fields from a later successful assessment.
-- The existing writer-only RLS policy remains the authorization boundary.
BEGIN;

GRANT UPDATE (severity,priority,title,description,recommended_action)
  ON searqon.recommendations TO searqon_app;

COMMIT;
