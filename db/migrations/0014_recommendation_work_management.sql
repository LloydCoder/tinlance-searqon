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

COMMIT;
