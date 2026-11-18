-- Record severity changes when the same stable finding regresses or improves.
BEGIN;

ALTER TABLE searqon.recommendation_events
  DROP CONSTRAINT recommendation_events_event_type_check;

ALTER TABLE searqon.recommendation_events
  ADD CONSTRAINT recommendation_events_event_type_check
  CHECK (event_type IN (
    'created','finding_reobserved','reopened','status_changed',
    'verification_succeeded','verification_failed',
    'assignment_changed','due_date_changed',
    'severity_escalated','severity_deescalated'
  ));

COMMIT;
