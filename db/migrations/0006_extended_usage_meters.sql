-- Extend durable usage accounting to fixed-quota product operations.
-- Manual assessments and supplied GEO observations do not permit overage.
BEGIN;

ALTER TABLE searqon.usage_period_counters
  DROP CONSTRAINT usage_period_counters_meter_check,
  DROP CONSTRAINT usage_period_meter_ceiling,
  DROP CONSTRAINT usage_period_total_meter_ceiling;
ALTER TABLE searqon.usage_period_counters
  ADD CONSTRAINT usage_period_counters_meter_check
    CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests','manual_assessments','supplied_geo_observations')),
  ADD CONSTRAINT usage_period_meter_ceiling CHECK (
    (meter = 'ai_answer_checks' AND included_limit <= 1000000)
    OR (meter = 'crawl_pages' AND included_limit <= 5000000)
    OR (meter = 'keyword_months' AND included_limit <= 1000000)
    OR (meter = 'api_requests' AND included_limit <= 5000000)
    OR (meter = 'manual_assessments' AND included_limit <= 100000)
    OR (meter = 'supplied_geo_observations' AND included_limit <= 1000000)
  ),
  ADD CONSTRAINT usage_period_total_meter_ceiling CHECK (
    (meter = 'ai_answer_checks' AND consumed_units + reserved_units <= 1000000)
    OR (meter = 'crawl_pages' AND consumed_units + reserved_units <= 5000000)
    OR (meter = 'keyword_months' AND consumed_units + reserved_units <= 1000000)
    OR (meter = 'api_requests' AND consumed_units + reserved_units <= 5000000)
    OR (meter = 'manual_assessments' AND consumed_units + reserved_units <= 100000)
    OR (meter = 'supplied_geo_observations' AND consumed_units + reserved_units <= 1000000)
  );

ALTER TABLE searqon.usage_reservations
  DROP CONSTRAINT usage_reservations_meter_check,
  DROP CONSTRAINT usage_reservation_meter_ceiling;
ALTER TABLE searqon.usage_reservations
  ADD CONSTRAINT usage_reservations_meter_check
    CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests','manual_assessments','supplied_geo_observations')),
  ADD CONSTRAINT usage_reservation_meter_ceiling CHECK (
    (meter = 'ai_answer_checks' AND requested_units <= 1000000)
    OR (meter = 'crawl_pages' AND requested_units <= 5000000)
    OR (meter = 'keyword_months' AND requested_units <= 1000000)
    OR (meter = 'api_requests' AND requested_units <= 5000000)
    OR (meter = 'manual_assessments' AND requested_units <= 100000)
    OR (meter = 'supplied_geo_observations' AND requested_units <= 1000000)
  );

ALTER TABLE searqon.usage_ledger_entries
  DROP CONSTRAINT usage_ledger_entries_meter_check;
ALTER TABLE searqon.usage_ledger_entries
  ADD CONSTRAINT usage_ledger_entries_meter_check
    CHECK (meter IN ('ai_answer_checks','crawl_pages','keyword_months','api_requests','manual_assessments','supplied_geo_observations'));

COMMIT;
