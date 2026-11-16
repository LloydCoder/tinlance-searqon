import test from "node:test";
import assert from "node:assert/strict";
import { createEmailSender, EmailDeliveryError } from "../src/platform/email.js";

test("Resend adapter sends a single transactional email with an idempotency key", async () => {
  let request;
  const sender = createEmailSender({
    apiKey: "re_test_key",
    from: "Searqon <no-reply@example.test>",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    }
  });
  const result = await sender.sendMagicLink({
    to: "user@example.test",
    url: "https://app.example.test/auth/verify/#token=abc&next=dashboard",
    idempotencyKey: "searqon-magic-link/123"
  });
  assert.deepEqual(result, { accepted: true });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer re_test_key");
  assert.equal(request.options.headers["idempotency-key"], "searqon-magic-link/123");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["user@example.test"]);
  assert.equal(body.from, "Searqon <no-reply@example.test>");
  assert.match(body.html, /&amp;next=dashboard/);
  assert.match(body.text, /expires in 15 minutes/);
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("Resend adapter does not expose provider response bodies on rejection", async () => {
  const sender = createEmailSender({
    apiKey: "re_test_key",
    from: "Searqon <no-reply@example.test>",
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "secret provider response" })
  });
  await assert.rejects(
    sender.sendMagicLink({ to: "user@example.test", url: "https://app.example.test/#token=x", idempotencyKey: "mail/1" }),
    error => error instanceof EmailDeliveryError && error.code === "email_provider_rejected" && !error.message.includes("secret")
  );
});

test("unconfigured production email delivery fails closed", async () => {
  let logged = false;
  const sender = createEmailSender({ apiKey: "", from: "", nodeEnv: "production", mode: "console", logger: () => { logged = true; } });
  await assert.rejects(
    sender.sendMagicLink({ to: "user@example.test", url: "https://app.example.test/#token=x", idempotencyKey: "mail/1" }),
    error => error instanceof EmailDeliveryError && error.code === "email_not_configured"
  );
  assert.equal(logged, false);
});

test("console magic-link delivery is available only in non-production mode", async () => {
  const logs = [];
  const sender = createEmailSender({ apiKey: "", from: "", nodeEnv: "development", mode: "console", logger: value => logs.push(value) });
  await sender.sendMagicLink({ to: "user@example.test", url: "http://127.0.0.1:4173/auth/verify/#token=x", idempotencyKey: "mail/1" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "searqon_magic_link_local_only");
});
