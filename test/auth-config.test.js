import test from "node:test";
import assert from "node:assert/strict";
import { getAuthConfigurationStatus } from "../src/platform/auth-config.js";

const complete = {
  databaseConfigured: true,
  publicOrigin: "https://searqon.tinlance.com",
  rateLimitSecret: "x".repeat(48),
  emailSenderAvailable: true
};

test("auth configuration is ready when all required dependencies are available", () => {
  assert.deepEqual(getAuthConfigurationStatus(complete), { configured: true, missing: [] });
});

test("auth configuration reports missing database without exposing credentials", () => {
  const status = getAuthConfigurationStatus({ ...complete, databaseConfigured: false });
  assert.equal(status.configured, false);
  assert.deepEqual(status.missing, ["DATABASE_URL"]);
});

test("auth configuration rejects a missing or short rate-limit secret", () => {
  for (const rateLimitSecret of ["", "short", undefined]) {
    const status = getAuthConfigurationStatus({ ...complete, rateLimitSecret });
    assert.equal(status.configured, false);
    assert.ok(status.missing.includes("AUTH_RATE_LIMIT_SECRET"));
  }
});

test("auth configuration reports unavailable transactional email", () => {
  const status = getAuthConfigurationStatus({ ...complete, emailSenderAvailable: false });
  assert.equal(status.configured, false);
  assert.ok(status.missing.includes("RESEND_API_KEY_OR_SEARQON_EMAIL_FROM"));
});

test("auth configuration reports every missing dependency in one diagnostic", () => {
  assert.deepEqual(getAuthConfigurationStatus({}), {
    configured: false,
    missing: [
      "DATABASE_URL",
      "PUBLIC_APP_ORIGIN",
      "AUTH_RATE_LIMIT_SECRET",
      "RESEND_API_KEY_OR_SEARQON_EMAIL_FROM"
    ]
  });
});
