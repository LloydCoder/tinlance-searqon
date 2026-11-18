BEGIN;

ALTER TABLE searqon.billing_webhook_inbox
  DROP CONSTRAINT billing_webhook_inbox_normalized_payload_check;

ALTER TABLE searqon.billing_webhook_inbox
  ADD CONSTRAINT billing_webhook_inbox_normalized_payload_check CHECK (
    jsonb_typeof(normalized_payload)='object'
    AND octet_length(normalized_payload::text)<=16384
    AND normalized_payload - ARRAY[
      'organizationId','providerCustomerId','providerSubscriptionId','status','plan',
      'currentPeriodStart','currentPeriodEnd','trialEndsAt','checkoutIntentId','providerTransactionId'
    ]='{}'::jsonb
  );

COMMIT;
