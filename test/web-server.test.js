import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../apps/web/server.js";

async function withServer(run, options = {}) {
  const server = createAppServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("web API exposes a minimal health contract without leaking configuration", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "searqon-web", apiVersion: "v1" });
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });
});

test("assessment endpoint returns the existing evidence-backed analyzer contract", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "customer-supplied.html",
        contentType: "text/html",
        content: "<html><head><title>Example documentation</title></head><body><h1>API guide</h1></body></html>"
      })
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.schemaVersion, "1.0.0");
    assert.equal(result.evidence.source, "customer-supplied.html");
    assert.ok(Array.isArray(result.findings));
    assert.ok(result.findings.every(item => item.evidenceId === result.evidence.id));
  });
});

test("assessment endpoint rejects unsupported media types without invoking the analyzer", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "payload.bin", contentType: "application/octet-stream", content: "x" })
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, "unsupported_media_type");
  });
});

test("assessment endpoint rejects malformed JSON and oversized request bodies", async () => {
  await withServer(async base => {
    const malformed = await fetch(base + "/api/v1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    const oversized = await fetch(base + "/api/v1/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "large.html", contentType: "text/html", content: "x".repeat(2 * 1024 * 1024 + 1) })
    });
    assert.equal(oversized.status, 413);
  });
});

test("unknown API routes return structured not-found responses", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/unknown");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
  });
});

test("serves the landing page and honors HEAD without returning a response body", async () => {
  await withServer(async base => {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Understand Visibility/);
    const head = await fetch(base + "/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
});

test("landing page follows the brand kit prohibition on gradients and magnifier icons", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/");
    const page = await response.text();
    const stylesheet = await fetch(base + "/styles.css").then(result => result.text());
    assert.equal(page.includes("<linearGradient"), false);
    assert.equal(page.includes('circle cx="10.8"'), false);
    assert.match(stylesheet, /#E8A33D/);
  });
});

test("auth routes fail closed when no database-backed auth service is configured", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(base).origin },
      body: JSON.stringify({ email: "user@example.test", displayName: "User", organizationName: "Workspace" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "auth_unavailable");
  });
});

test("auth API enforces same-origin requests and bounded JSON bodies", async () => {
  let calls = 0;
  let origin;
  const authService = {
    get publicOrigin() { return origin; },
    async register() { calls += 1; return { accepted: true }; },
    async requestMagicLink() { calls += 1; return { accepted: true }; },
    async verify() { calls += 1; return { sessionToken: "A".repeat(43), expiresAt: new Date(Date.now() + 86400000) }; },
    async getProfile() { return { user: { id: "user" }, organizations: [] }; },
    async logout() { return { revoked: true }; }
  };
  await withServer(async base => {
    origin = new URL(base).origin;
    const crossOrigin = await fetch(base + "/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ email: "user@example.test", displayName: "User", organizationName: "Workspace" })
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(calls, 0);

    const oversized = await fetch(base + "/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "user@example.test", displayName: "x".repeat(17000), organizationName: "Workspace" })
    });
    assert.equal(oversized.status, 413);
    assert.equal(calls, 0);

    const registered = await fetch(base + "/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "user@example.test", displayName: "User", organizationName: "Workspace" })
    });
    assert.equal(registered.status, 202);
    assert.equal(calls, 1);
  }, { authService });
});

test("magic-link verification sets an HttpOnly session cookie and profile/logout use it", async () => {
  let origin;
  let observedToken;
  const authService = {
    get publicOrigin() { return origin; },
    async register() { return { accepted: true }; },
    async requestMagicLink() { return { accepted: true }; },
    async verify(token) {
      observedToken = token;
      return { sessionToken: "B".repeat(43), expiresAt: new Date(Date.now() + 86400000) };
    },
    async getProfile(token) {
      assert.equal(token, "B".repeat(43));
      return { user: { id: "user-1", email: "user@example.test" }, organizations: [] };
    },
    async logout(token) {
      assert.equal(token, "B".repeat(43));
      return { revoked: true };
    }
  };
  await withServer(async base => {
    origin = new URL(base).origin;
    const verified = await fetch(base + "/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ token: "C".repeat(43) })
    });
    assert.equal(verified.status, 200);
    assert.equal(observedToken, "C".repeat(43));
    const cookie = verified.headers.get("set-cookie");
    assert.match(cookie, /^searqon_session=B{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=/);

    const profile = await fetch(base + "/api/v1/auth/me", { headers: { cookie } });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).user.id, "user-1");

    const logout = await fetch(base + "/api/v1/auth/logout", {
      method: "POST",
      headers: { origin, cookie }
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  }, { authService });
});

test("auth API rejects unsupported methods and missing request origins", async () => {
  let origin;
  const authService = {
    get publicOrigin() { return origin; },
    async register() { throw new Error("must not be called"); },
    async requestMagicLink() {},
    async verify() {},
    async getProfile() {},
    async logout() {}
  };
  await withServer(async base => {
    origin = new URL(base).origin;
    const method = await fetch(base + "/api/v1/auth/register");
    assert.equal(method.status, 405);
    const missingOrigin = await fetch(base + "/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.test" })
    });
    assert.equal(missingOrigin.status, 403);
  }, { authService });
});

test("serves directory-based authentication and workspace routes", async () => {
  await withServer(async base => {
    for (const [path, marker] of [
      ["/auth/register/", "Create your workspace"],
      ["/auth/login/", "Sign in to Searqon"],
      ["/auth/verify/", "Confirm your sign-in"],
      ["/app/", "Your visibility baseline"]
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /text\/html/, path);
      assert.match(await response.text(), new RegExp(marker), path);
    }
    const script = await fetch(base + "/auth/auth.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
  });
});

test("readiness endpoint fails closed when PostgreSQL is not configured", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/api/v1/ready");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "not_ready", reason: "database_not_configured" });
  });
});

test("production assessment endpoint fails closed without authenticated service", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await withServer(async base => {
      const response = await fetch(base + "/api/v1/assessments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "sample", contentType: "text/markdown", content: "# Sample" })
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "assessment_unavailable");
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("production session cookies use the __Host prefix and Secure attribute", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let origin;
  const authService = {
    get publicOrigin() { return origin; },
    async register() {},
    async requestMagicLink() {},
    async verify() { return { sessionToken: "D".repeat(43), expiresAt: new Date(Date.now() + 3600000) }; },
    async getProfile() { return null; },
    async logout() { return { revoked: true }; }
  };
  try {
    await withServer(async base => {
      origin = new URL(base).origin;
      const response = await fetch(base + "/api/v1/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ token: "E".repeat(43) })
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie"), /^__Host-searqon_session=D{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
      assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
    }, { authService });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("serves the supplied Searqon favicon and keeps authentication pages out of search indexes", async () => {
  await withServer(async base => {
    const favicon = await fetch(base + "/favicon.svg");
    assert.equal(favicon.status, 200);
    const svg = await favicon.text();
    assert.match(svg, /#12203A/);
    assert.match(svg, /#F6F3EC/);
    assert.match(svg, /#E8A33D/);

    for (const path of ["/auth/register/", "/auth/login/", "/auth/verify/"]) {
      const page = await fetch(base + path).then(response => response.text());
      assert.match(page, /name="robots" content="noindex, nofollow"/);
    }
    const verify = await fetch(base + "/auth/verify/").then(response => response.text());
    assert.match(verify, /name="referrer" content="no-referrer"/);
  });
});

test("marketing stylesheet follows the supplied flat-color and amber signal rules", async () => {
  await withServer(async base => {
    const stylesheet = await fetch(base + "/styles.css").then(response => response.text());
    assert.equal(/linear-gradient|radial-gradient|conic-gradient/i.test(stylesheet), false);
    assert.match(stylesheet, /--amber:#E8A33D/);
    assert.match(stylesheet, /--amber-deep:#8A5200/);
    assert.match(stylesheet, /--serif:var\(--sans\)/);
  });
});
