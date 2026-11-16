import test from "node:test";
import assert from "node:assert/strict";
import { createAuthService, AuthError } from "../src/platform/auth.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ORG_ID = "20000000-0000-4000-8000-000000000001";

function fakeDatabase({ rateAllowed = true, registerRows, issueRows, verifyRows, sessionRows, profileRows } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values, transaction: true });
      if (sql.includes("FROM searqon.app_users")) return { rows: [{ id: USER_ID, email: "user@example.test", display_name: "User", email_verified_at: new Date() }] };
      if (sql.includes("FROM searqon.organizations")) return { rows: [{ id: ORG_ID, name: "Workspace", slug: "workspace", role: "owner" }] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("consume_auth_rate_limit")) return { rows: [{ allowed: rateAllowed }] };
      if (sql.includes("register_account")) return { rows: registerRows ?? [{ user_id: USER_ID, organization_id: ORG_ID, token_id: "30000000-0000-4000-8000-000000000001" }] };
      if (sql.includes("issue_magic_link")) return { rows: issueRows ?? [{ user_id: USER_ID, token_id: "30000000-0000-4000-8000-000000000002" }] };
      if (sql.includes("consume_magic_link_and_create_session")) return { rows: verifyRows ?? [{ user_id: USER_ID, session_id: "40000000-0000-4000-8000-000000000001", session_expires_at: new Date(Date.now() + 86400000) }] };
      if (sql.includes("lookup_session")) return { rows: sessionRows ?? [{ user_id: USER_ID, session_expires_at: new Date(Date.now() + 86400000) }] };
      if (sql.includes("revoke_session")) return { rows: [{ revoked: true }] };
      return { rows: [] };
    },
    async connect() { return client; }
  };
  return { pool, calls: pool.calls };
}

function emailSender() {
  const sent = [];
  return {
    sent,
    async sendMagicLink(message) { sent.push(message); }
  };
}

test("auth service rejects insecure production origins and missing rate-limit secret", () => {
  const database = fakeDatabase();
  assert.throws(() => createAuthService({
    database,
    emailSender: emailSender(),
    nodeEnv: "production",
    publicOrigin: "http://app.example.test",
    rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes"
  }), /HTTPS/);
  assert.throws(() => createAuthService({
    database,
    emailSender: emailSender(),
    nodeEnv: "production",
    publicOrigin: "https://app.example.test",
    rateLimitSecret: ""
  }), /AUTH_RATE_LIMIT_SECRET/);
});

test("registration normalizes identity, creates workspace, and sends a fragment-only magic link", async () => {
  const database = fakeDatabase();
  const mail = emailSender();
  const auth = createAuthService({
    database,
    emailSender: mail,
    nodeEnv: "test",
    publicOrigin: "https://app.example.test",
    rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes"
  });
  const result = await auth.register({
    email: "  USER@Example.Test ",
    displayName: "Test User",
    organizationName: "Example Workspace"
  }, "203.0.113.10");

  assert.deepEqual(result, { accepted: true });
  const registration = database.calls.find(call => call.sql?.includes("register_account"));
  assert.equal(registration.values[0], "user@example.test");
  assert.equal(registration.values[1], "Test User");
  assert.equal(registration.values[2], "Example Workspace");
  assert.match(registration.values[3], /^example-workspace-[a-f0-9]{6}$/);
  assert.equal(Buffer.from(registration.values[4]).length, 32);
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, "user@example.test");
  assert.ok(mail.sent[0].url.startsWith("https://app.example.test/auth/verify/#token="));
  assert.match(new URL(mail.sent[0].url).hash, /^#token=[A-Za-z0-9_-]{43}$/);
  assert.match(mail.sent[0].idempotencyKey, /^searqon-magic-link\//);
});

test("duplicate registration sends a new sign-in link without exposing account existence", async () => {
  const database = fakeDatabase();
  database.pool.query = async (sql, values) => {
    database.calls.push({ sql, values });
    if (sql.includes("consume_auth_rate_limit")) return { rows: [{ allowed: true }] };
    if (sql.includes("register_account")) {
      const error = new Error("duplicate");
      error.code = "23505";
      error.constraint = "app_users_email_unique";
      throw error;
    }
    if (sql.includes("issue_magic_link")) return { rows: [{ user_id: USER_ID, token_id: "30000000-0000-4000-8000-000000000002" }] };
    return { rows: [] };
  };
  const mail = emailSender();
  const auth = createAuthService({ database, emailSender: mail, nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  assert.deepEqual(await auth.register({ email: "user@example.test", displayName: "User", organizationName: "Workspace" }, "127.0.0.1"), { accepted: true });
  assert.equal(mail.sent.length, 1);
  assert.ok(database.calls.some(call => call.sql.includes("issue_magic_link")));
});

test("magic-link request is generic and does not send mail for unknown accounts", async () => {
  const database = fakeDatabase({ issueRows: [] });
  const mail = emailSender();
  const auth = createAuthService({ database, emailSender: mail, nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  assert.deepEqual(await auth.requestMagicLink("nobody@example.test", "127.0.0.1"), { accepted: true });
  assert.equal(mail.sent.length, 0);
});

test("distributed rate limiting rejects requests before account lookup", async () => {
  const database = fakeDatabase({ rateAllowed: false });
  const auth = createAuthService({ database, emailSender: emailSender(), nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  await assert.rejects(auth.requestMagicLink("user@example.test", "127.0.0.1"), error => error instanceof AuthError && error.statusCode === 429);
  assert.equal(database.calls.some(call => call.sql?.includes("issue_magic_link")), false);
});

test("verification consumes a one-time token and returns an opaque session secret", async () => {
  const database = fakeDatabase();
  const auth = createAuthService({ database, emailSender: emailSender(), nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  const result = await auth.verify("A".repeat(43));
  assert.equal(result.userId, USER_ID);
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(result.expiresAt instanceof Date);
  const call = database.calls.find(item => item.sql?.includes("consume_magic_link_and_create_session"));
  assert.equal(Buffer.from(call.values[0]).length, 32);
  assert.equal(Buffer.from(call.values[1]).length, 32);
});

test("invalid or expired magic links are rejected without creating a session", async () => {
  const database = fakeDatabase({ verifyRows: [] });
  const auth = createAuthService({ database, emailSender: emailSender(), nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  await assert.rejects(auth.verify("A".repeat(43)), error => error instanceof AuthError && error.statusCode === 400);
  await assert.rejects(auth.verify("not-a-token"), error => error instanceof AuthError && error.statusCode === 400);
});

test("session lookup returns workspace-scoped profile and logout revokes the token", async () => {
  const database = fakeDatabase();
  const auth = createAuthService({ database, emailSender: emailSender(), nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  const profile = await auth.getProfile("A".repeat(43));
  assert.equal(profile.user.id, USER_ID);
  assert.equal(profile.organizations[0].id, ORG_ID);
  assert.deepEqual(await auth.logout("A".repeat(43)), { revoked: true });
  assert.ok(database.calls.some(call => call.sql?.includes("lookup_session")));
  assert.ok(database.calls.some(call => call.sql?.includes("revoke_session")));
});

test("invalid session secrets do not reach the database", async () => {
  const database = fakeDatabase();
  const auth = createAuthService({ database, emailSender: emailSender(), nodeEnv: "test", publicOrigin: "http://127.0.0.1:4173", rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes" });
  assert.equal(await auth.getProfile("invalid"), null);
  assert.deepEqual(await auth.logout("invalid"), { revoked: false });
  assert.equal(database.calls.some(call => call.sql?.includes("lookup_session")), false);
});

test("registration fails closed before database writes when email delivery is disabled", async () => {
  const database = fakeDatabase();
  const auth = createAuthService({
    database,
    emailSender: { available: false, async sendMagicLink() { throw new Error("must not be called"); } },
    nodeEnv: "test",
    publicOrigin: "http://127.0.0.1:4173",
    rateLimitSecret: "this-secret-is-at-least-thirty-two-bytes"
  });
  await assert.rejects(
    auth.register({ email: "user@example.test", displayName: "User", organizationName: "Workspace" }, "127.0.0.1"),
    error => error instanceof AuthError && error.statusCode === 503
  );
  assert.equal(database.calls.some(call => call.sql?.includes("register_account")), false);
  assert.equal(database.calls.some(call => call.sql?.includes("issue_magic_link")), false);
});
