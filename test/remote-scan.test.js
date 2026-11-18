import test from "node:test";
import assert from "node:assert/strict";
import { scanPublicUrl } from "../src/remote-scan.js";

const allowedRobots = async () => ({
  outcome: "available",
  policy: { groups: [], sitemaps: [] }
});

test("remote scanner checks robots policy before fetching the target", async () => {
  const calls = [];
  const result = await scanPublicUrl("https://example.com/docs", {
    confirmAuthorizedTarget: true,
    robotsLoader: async (origin, agent) => { calls.push(["robots", origin, agent]); return allowedRobots(); },
    fetcher: async (url, options) => {
      calls.push(["fetch", url, typeof options.validateRedirect]);
      return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from("<html><title>Docs</title><h1>API</h1></html>"), finalUrl: url, redirects: 0 };
    },
    now: () => "2026-11-14T00:00:00.000Z"
  });
  assert.equal(result.status, "scanned");
  assert.equal(result.assessment.observationClass, "crawl");
  assert.equal(result.assessment.evidence.acquisitionMethod, "http_get");
  assert.deepEqual(calls[0], ["robots", "https://example.com", "SearqonBot"]);
  assert.equal(calls[1][0], "fetch");
});

test("remote scanner refuses a robots-disallowed path without fetching it", async () => {
  let fetched = false;
  const result = await scanPublicUrl("https://example.com/private", {
    confirmAuthorizedTarget: true,
    robotsLoader: async () => ({ outcome: "available", policy: { groups: [{ userAgents: ["*"], rules: [{ type: "disallow", path: "/private", specificity: 8, pattern: /^\/private/ }] }] } }),
    fetcher: async () => { fetched = true; throw new Error("must not fetch"); }
  });
  assert.equal(result.status, "blocked_by_robots");
  assert.equal(fetched, false);
});

test("remote scanner fails closed when robots retrieval is unreachable", async () => {
  let fetched = false;
  const result = await scanPublicUrl("https://example.com/", {
    confirmAuthorizedTarget: true,
    robotsLoader: async () => ({ outcome: "unreachable", policy: { groups: [], sitemaps: [] } }),
    fetcher: async () => { fetched = true; }
  });
  assert.equal(result.status, "robots_unreachable");
  assert.equal(fetched, false);
});

test("remote scanner checks robots policy again before following cross-origin redirects", async () => {
  const robotOrigins = [];
  let redirectValidator;
  const result = await scanPublicUrl("https://example.com/start", {
    confirmAuthorizedTarget: true,
    allowedRedirectOrigins: ["https://other.example.com"],
    robotsLoader: async origin => { robotOrigins.push(origin); return allowedRobots(); },
    fetcher: async (url, options) => {
      redirectValidator = options.validateRedirect;
      const allowed = await redirectValidator({ from: url, to: "https://other.example.com/final", redirectCount: 1 });
      assert.equal(allowed, true);
      return { status: 200, headers: { "content-type": "text/markdown" }, body: Buffer.from("# API docs\nAuthentication and versioning."), finalUrl: "https://other.example.com/final", redirects: 1 };
    }
  });
  assert.equal(result.status, "scanned");
  assert.deepEqual(robotOrigins, ["https://example.com", "https://other.example.com"]);
});

test("remote scanner blocks a redirect when destination robots policy disallows it", async () => {
  const result = await scanPublicUrl("https://example.com/start", {
    confirmAuthorizedTarget: true,
    allowedRedirectOrigins: ["https://other.example.com"],
    robotsLoader: async origin => origin === "https://example.com"
      ? allowedRobots()
      : ({ outcome: "available", policy: { groups: [{ userAgents: ["*"], rules: [{ type: "disallow", path: "/", specificity: 1, pattern: /^/ }] }] } }),
    fetcher: async (url, options) => {
      const allowed = await options.validateRedirect({ from: url, to: "https://other.example.com/private", redirectCount: 1 });
      if (!allowed) throw Object.assign(new Error("blocked by redirect policy"), { code: "ERR_REDIRECT_POLICY" });
      throw new Error("redirect should have been denied");
    }
  });
  assert.equal(result.status, "blocked_by_robots");
});

test("remote scanner accepts only supported media types and bounded responses", async () => {
  const unsupported = await scanPublicUrl("https://example.com/file", {
    confirmAuthorizedTarget: true,
    robotsLoader: allowedRobots,
    fetcher: async url => ({ status: 200, headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF"), finalUrl: url, redirects: 0 })
  });
  assert.equal(unsupported.status, "unsupported_content_type");
  const tooLarge = await scanPublicUrl("https://example.com/large", {
    confirmAuthorizedTarget: true,
    robotsLoader: allowedRobots,
    maxBytes: 10,
    fetcher: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("x".repeat(11)) })
  });
  assert.equal(tooLarge.status, "fetch_failed");
});

test("remote scanner sanitizes source provenance and never records query parameters", async () => {
  const result = await scanPublicUrl("https://example.com/docs?token=secret", {
    confirmAuthorizedTarget: true,
    robotsLoader: allowedRobots,
    fetcher: async url => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html><title>Docs</title></html>"), finalUrl: url, redirects: 0 })
  });
  assert.equal(result.assessment.evidence.source, "https://example.com/docs");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("remote scanner rejects unsafe targets before robots or HTTP requests", async () => {
  let called = false;
  await assert.rejects(() => scanPublicUrl("http://127.0.0.1/admin", {
    confirmAuthorizedTarget: true,
    robotsLoader: async () => { called = true; },
    fetcher: async () => { called = true; }
  }), /non-public/);
  assert.equal(called, false);
});


test("remote scanner requires explicit authorization from every API caller before robots or HTTP access", async () => {
  let contacted = false;
  await assert.rejects(() => scanPublicUrl("https://example.com/docs", {
    robotsLoader: async () => { contacted = true; return allowedRobots(); },
    fetcher: async () => { contacted = true; throw new Error("must not fetch"); }
  }), /explicit authorization/);
  assert.equal(contacted, false);
});


test("remote scanner blocks cross-origin redirects unless the destination origin is explicitly authorized", async () => {
  const robotOrigins = [];
  const result = await scanPublicUrl("https://example.com/start", {
    confirmAuthorizedTarget: true,
    robotsLoader: async origin => { robotOrigins.push(origin); return allowedRobots(); },
    fetcher: async (url, options) => {
      const allowed = await options.validateRedirect({ from: url, to: "https://other.example.com/final", redirectCount: 1 });
      assert.equal(allowed, false);
      throw Object.assign(new Error("cross-origin redirect not authorized"), { code: "ERR_REDIRECT_POLICY" });
    }
  });
  assert.equal(result.status, "redirect_not_authorized");
  assert.deepEqual(robotOrigins, ["https://example.com"]);
});

test("remote scanner rejects malformed cross-origin authorization entries before network access", async () => {
  let contacted = false;
  await assert.rejects(() => scanPublicUrl("https://example.com/start", {
    confirmAuthorizedTarget: true,
    allowedRedirectOrigins: ["https://user:pass@other.example.com/path"],
    robotsLoader: async () => { contacted = true; return allowedRobots(); },
    fetcher: async () => { contacted = true; }
  }), /allowedRedirectOrigins/);
  assert.equal(contacted, false);
});


test("remote scanner classifies unsafe redirect destinations separately and never checks their robots policy", async () => {
  const robotOrigins = [];
  const result = await scanPublicUrl("https://example.com/start", {
    confirmAuthorizedTarget: true,
    robotsLoader: async origin => { robotOrigins.push(origin); return allowedRobots(); },
    fetcher: async (url, options) => {
      const allowed = await options.validateRedirect({ from: url, to: "http://127.0.0.1/admin", redirectCount: 1 });
      assert.equal(allowed, false);
      throw Object.assign(new Error("unsafe redirect blocked"), { code: "ERR_REDIRECT_POLICY" });
    }
  });
  assert.equal(result.status, "redirect_blocked_by_policy");
  assert.deepEqual(robotOrigins, ["https://example.com"]);
});


test("remote scanner passes one crawler identity to robots evaluation and HTTP acquisition", async () => {
  let fetchedUserAgent = null;
  const result = await scanPublicUrl("https://example.com/docs", {
    confirmAuthorizedTarget: true,
    userAgent: "CustomBot",
    robotsLoader: async (origin, token, options) => {
      assert.equal(origin, "https://example.com");
      assert.equal(token, "CustomBot");
      assert.equal(options.userAgent, "CustomBot");
      return allowedRobots();
    },
    fetcher: async (url, options) => {
      fetchedUserAgent = options.userAgent;
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from("<html><title>Useful documentation for developers</title><body><h1>Docs</h1></body></html>"),
        finalUrl: url,
        redirects: 0
      };
    }
  });
  assert.equal(result.status, "scanned");
  assert.equal(fetchedUserAgent, "CustomBot");
});


test("remote scanner rejects digits in crawler product tokens before robots access", async () => {
  let robotsCalled = false;
  await assert.rejects(() => scanPublicUrl("https://example.com/docs", {
    confirmAuthorizedTarget: true,
    userAgent: "SearqonBot2",
    robotsLoader: async () => { robotsCalled = true; return allowedRobots(); }
  }), /product token/);
  assert.equal(robotsCalled, false);
});
