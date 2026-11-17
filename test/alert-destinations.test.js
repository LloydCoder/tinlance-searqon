import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createAlertDestinationStore,
  decryptDestinationSecret,
  encryptDestinationSecret,
  validateAlertDestinationSecret
} from "../src/platform/alert-destinations.js";

const keyring = {currentVersion:"k1",keys:{k1:randomBytes(32)}};
const tenant = "20000000-0000-4000-8000-000000000001";
const destination = "30000000-0000-4000-8000-000000000001";

test("AES-256-GCM destination encryption binds ciphertext to tenant, destination, channel and key version", () => {
  const secret = "https://hooks.slack.com/services/T000/B000/very-secret-value";
  const encrypted = encryptDestinationSecret({secret,organizationId:tenant,destinationId:destination,channel:"slack",keyring});
  assert.notEqual(encrypted.ciphertext.toString("utf8"),secret);
  assert.equal(encrypted.nonce.length,12);
  assert.equal(encrypted.tag.length,16);
  assert.equal(encrypted.keyVersion,"k1");
  assert.equal(decryptDestinationSecret({...encrypted,organizationId:tenant,destinationId:destination,channel:"slack",keyring}),secret);
  assert.throws(
    () => decryptDestinationSecret({...encrypted,organizationId:"40000000-0000-4000-8000-000000000001",destinationId:destination,channel:"slack",keyring}),
    error => error.code === "destination_secret_unavailable"
  );
  const tampered = {...encrypted,ciphertext:Buffer.from(encrypted.ciphertext)};
  tampered.ciphertext[0] ^= 1;
  assert.throws(
    () => decryptDestinationSecret({...tampered,organizationId:tenant,destinationId:destination,channel:"slack",keyring}),
    error => error.code === "destination_secret_unavailable"
  );
});

test("destination secrets are validated against channel-specific endpoint rules", () => {
  assert.equal(validateAlertDestinationSecret("slack","https://hooks.slack.com/services/T000/B000/secret"),"https://hooks.slack.com/services/T000/B000/secret");
  assert.throws(() => validateAlertDestinationSecret("teams","https://tenant.webhook.office.com/webhookb2/legacy"),error=>error.code==="invalid_destination_secret");
  assert.equal(validateAlertDestinationSecret("teams","https://tenant.logic.azure.com/workflows/secret?sig=secret"),"https://tenant.logic.azure.com/workflows/secret?sig=secret");
  assert.equal(validateAlertDestinationSecret("pagerduty","A".repeat(32)),"A".repeat(32));
  assert.throws(() => validateAlertDestinationSecret("slack","https://attacker.example/services/secret"),error=>error.code==="invalid_destination_secret");
  assert.throws(() => validateAlertDestinationSecret("slack","http://hooks.slack.com/services/secret"),error=>error.code==="invalid_destination_secret");
  assert.throws(() => validateAlertDestinationSecret("slack","https://user:pass@hooks.slack.com/services/secret"),error=>error.code==="invalid_destination_secret");
  assert.throws(() => validateAlertDestinationSecret("teams","https://tenant.example.com/webhook?sig=secret"),error=>error.code==="invalid_destination_secret");
  assert.throws(() => validateAlertDestinationSecret("pagerduty","short"),error=>error.code==="invalid_destination_secret");
  assert.throws(() => validateAlertDestinationSecret("unknown","secret"),error=>error.code==="invalid_channel");
});

test("keyring validation fails closed for missing, malformed or weak keys", () => {
  assert.throws(() => encryptDestinationSecret({secret:"A".repeat(32),organizationId:tenant,destinationId:destination,channel:"pagerduty",keyring:{currentVersion:"k1",keys:{}}}),error=>error.code==="encryption_key_unavailable");
  assert.throws(() => encryptDestinationSecret({secret:"A".repeat(32),organizationId:tenant,destinationId:destination,channel:"pagerduty",keyring:{currentVersion:"k1",keys:{k1:Buffer.alloc(16)}}}),error=>error.code==="encryption_key_unavailable");
});

test("alert destination store requires a PostgreSQL pool and a valid keyring", () => {
  assert.throws(() => createAlertDestinationStore(),/PostgreSQL database pool/);
  assert.throws(() => createAlertDestinationStore({database:{pool:{connect(){}}}}),/encryption keyring/);
});
