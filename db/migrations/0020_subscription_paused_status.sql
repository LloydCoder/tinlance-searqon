BEGIN;
ALTER TABLE searqon.subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE searqon.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active','trialing','past_due','paused','canceled','expired','free'));
COMMIT;
