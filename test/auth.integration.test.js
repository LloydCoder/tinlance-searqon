import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/platform/database.js";
import { createAuthService, AuthError } from "../src/platform/auth.js";

const databaseUrl = process.env.DATABASE_URL;
let isDisposableDatabase = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    isDisposableDatabase = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(databaseName);
  } catch {}
}

test("passwordless auth completes registration, token replacement, session lookup and logout on PostgreSQL", { skip: !isDisposableDatabase }, async () => {
  const database = createDatabase({ connectionString: databaseUrl, maxConnections: 1 });
  const email = "auth-integration-" + randomUUID() + "@example.test";
  const ip = "198.51.100.19";
  const sent = [];
  const rateLimitSecret = "searqon-postgres-integration-secret-32-bytes";
  const auth = createAuthService({
    database,
    emailSender: {
      available: true,
      async sendMagicLink(message) { sent.push(message); }
    },
    nodeEnv: "test",
    publicOrigin: "http://127.0.0.1:4173",
    rateLimitSecret
  });

  try {
    assert.deepEqual(await auth.register({
      email,
      displayName: "Auth Integration",
      organizationName: "Integration Workspace " + randomUUID().slice(0, 8)
    }, ip), { accepted: true });
    assert.equal(sent.length, 1);

    const firstToken = new URL(sent[0].url).hash.slice("#token=".length);
    assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);

    await auth.requestMagicLink(email, ip);
    assert.equal(sent.length, 2);
    const secondToken = new URL(sent[1].url).hash.slice("#token=".length);
    assert.match(secondToken, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(firstToken, secondToken);

    await assert.rejects(
      auth.verify(firstToken),
      error => error instanceof AuthError && error.code === "invalid_or_expired_link"
    );

    const session = await auth.verify(secondToken);
    assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(session.expiresAt instanceof Date);

    const profile = await auth.getProfile(session.sessionToken);
    assert.equal(profile.user.email, email);
    assert.ok(profile.user.email_verified_at);
    assert.equal(profile.organizations.length, 1);
    assert.equal(profile.organizations[0].role, "owner");
    assert.deepEqual(await auth.logout(session.sessionToken), { revoked: true });
    assert.equal(await auth.getProfile(session.sessionToken), null);
  } finally {
    // This test is enabled only against an explicitly marked disposable *_test or *_ci database.
    // TRUNCATE bypasses row DELETE triggers while retaining the production append-only audit invariant.
    await database.pool.query(`TRUNCATE TABLE
      searqon.audit_events,
      searqon.assessments,
      searqon.projects,
      searqon.sessions,
      searqon.auth_tokens,
      searqon.auth_rate_limits,
      searqon.memberships,
      searqon.organizations,
      searqon.app_users
      RESTART IDENTITY CASCADE`);
    await database.close();
  }
});
