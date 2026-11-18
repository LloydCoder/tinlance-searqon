import test from "node:test";
import assert from "node:assert/strict";
import { fetchRobotsPolicy } from "../src/security/robots-fetch.js";
import { evaluateRobots } from "../src/security/robots.js";

const origin = "https://example.com";

test("successful robots response is parsed and cached per origin", async () => {
  const cache = new Map();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, "https://example.com/robots.txt");
    assert.equal(options.maxRedirects, 5);
    assert.equal(options.maxBytes, 512 * 1024);
    return { status: 200, headers: { "cache-control": "max-age=600" }, body: Buffer.from("User-agent: *\nDisallow: /private") , finalUrl: url, redirects: 0 };
  };
  const first = await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 1_000_000 });
  assert.equal(first.outcome, "available");
  assert.equal(evaluateRobots(first.policy, "https://example.com/private/data", "SearqonBot").allowed, false);
  const second = await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 1_001_000 });
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
});

test("expired robots entries are refreshed", async () => {
  const cache = new Map();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { status: 200, headers: { "cache-control": "max-age=1" }, body: Buffer.from("User-agent: *\nDisallow: /") };
  };
  await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 10_000 });
  const refreshed = await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 12_000 });
  assert.equal(refreshed.cacheHit, false);
  assert.equal(calls, 2);
});

test("4xx robots responses are treated as unavailable and do not restrict crawling", async () => {
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache: new Map(),
    fetcher: async () => ({ status: 404, headers: {}, body: Buffer.from("not found") })
  });
  assert.equal(result.outcome, "unavailable");
  assert.equal(evaluateRobots(result.policy, "https://example.com/private", "SearqonBot").allowed, true);
});

test("429 and 5xx responses fail closed with a disallow-all policy", async () => {
  for (const status of [429, 500, 503]) {
    const result = await fetchRobotsPolicy(origin, "SearqonBot", {
      cache: new Map(),
      fetcher: async () => ({ status, headers: {}, body: Buffer.alloc(0) })
    });
    assert.equal(result.outcome, "unreachable");
    assert.equal(evaluateRobots(result.policy, "https://example.com/anything", "SearqonBot").allowed, false);
  }
});

test("Retry-After controls the temporary failure cache window", async () => {
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache: new Map(),
    now: () => 100_000,
    fetcher: async () => ({ status: 503, headers: { "retry-after": "120" }, body: Buffer.alloc(0) })
  });
  assert.equal(result.expiresAt, 220_000);
});

test("network and parsing failures fail closed without trusting partial robots data", async () => {
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache: new Map(),
    fetcher: async () => { throw new Error("socket reset"); }
  });
  assert.equal(result.outcome, "unreachable");
  assert.equal(evaluateRobots(result.policy, "https://example.com/", "SearqonBot").allowed, false);
});

test("no-store responses are not cached", async () => {
  const cache = new Map();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { status: 200, headers: { "cache-control": "no-store" }, body: Buffer.from("User-agent: *\nAllow: /") };
  };
  await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher });
  await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher });
  assert.equal(calls, 2);
  assert.equal(cache.size, 0);
});

test("invalid UTF-8 robots content fails closed", async () => {
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache: new Map(),
    fetcher: async () => ({ status: 200, headers: {}, body: Buffer.from([0xff, 0xfe, 0xfd]) })
  });
  assert.equal(result.outcome, "unreachable");
  assert.equal(evaluateRobots(result.policy, "https://example.com/", "SearqonBot").allowed, false);
});

test("invalid origins are rejected before acquisition", async () => {
  await assert.rejects(() => fetchRobotsPolicy("http://127.0.0.1", "SearqonBot", {
    fetcher: async () => { throw new Error("must not run"); }
  }), /non-public/);
});


test("malformed fetch responses fail closed and use the short failure cache", async () => {
  const cache = new Map();
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache,
    now: () => 50_000,
    fetcher: async () => ({ headers: {}, body: Buffer.alloc(0) })
  });
  assert.equal(result.outcome, "unreachable");
  assert.equal(result.expiresAt, 80_000);
  assert.equal(evaluateRobots(result.policy, "https://example.com/", "SearqonBot").allowed, false);
});

test("robots cache enforces a bounded entry count", async () => {
  const cache = new Map();
  const fetcher = async url => ({ status: 200, headers: {}, body: Buffer.from("User-agent: *\nAllow: /"), finalUrl: url });
  await fetchRobotsPolicy("https://one.example.com", "SearqonBot", { cache, fetcher, maxEntries: 1 });
  await fetchRobotsPolicy("https://two.example.com", "SearqonBot", { cache, fetcher, maxEntries: 1 });
  assert.equal(cache.size, 1);
  assert.equal(cache.has("https://two.example.com\nsearqonbot"), true);
  assert.equal(cache.has("https://one.example.com\nsearqonbot"), false);
});

test("invalid cache bounds are rejected", async () => {
  await assert.rejects(() => fetchRobotsPolicy(origin, "SearqonBot", {
    maxEntries: 0,
    fetcher: async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) })
  }), /maxEntries/);
});


test("unfollowable redirect responses fail closed with a short cache lifetime", async () => {
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache: new Map(),
    now: () => 20_000,
    fetcher: async () => ({ status: 302, headers: {}, body: Buffer.alloc(0) })
  });
  assert.equal(result.outcome, "unreachable");
  assert.equal(result.expiresAt, 50_000);
  assert.equal(evaluateRobots(result.policy, "https://example.com/", "SearqonBot").allowed, false);
});


test("robots retrieval forwards the product token and caches policies separately per token", async () => {
  const cache = new Map();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.userAgent, calls === 1 ? "SearqonBot" : "CustomBot");
    assert.equal(options.validateRedirect({ to: "https://example.com/robots.txt" }), true);
    assert.equal(options.validateRedirect({ to: "https://other.example.net/robots.txt" }), false);
    return { status: 200, headers: { "cache-control": "max-age=600" }, body: Buffer.from("User-agent: *\nAllow: /"), finalUrl: url };
  };
  await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 1000 });
  await fetchRobotsPolicy(origin, "CustomBot", { cache, fetcher, now: () => 1000 });
  await fetchRobotsPolicy(origin, "SearqonBot", { cache, fetcher, now: () => 1001 });
  assert.equal(calls, 2);
  assert.equal(cache.has("https://example.com\nsearqonbot"), true);
  assert.equal(cache.has("https://example.com\ncustombot"), true);
});

test("cross-origin robots redirect results fail closed and cache only a short-lived denial", async () => {
  const cache = new Map();
  const result = await fetchRobotsPolicy(origin, "SearqonBot", {
    cache,
    fetcher: async () => ({
      status: 200,
      headers: { "cache-control": "max-age=600" },
      body: Buffer.from("User-agent: *\nAllow: /"),
      finalUrl: "https://other.example.net/robots.txt",
      redirects: 1
    })
  });
  assert.equal(result.outcome, "unreachable");
  assert.equal(result.error, "Cross-origin robots.txt redirect is not permitted");
  assert.equal(evaluateRobots(result.policy, "https://example.com/", "SearqonBot").allowed, false);
  assert.equal(cache.size, 1); // Short failure cache only; no permissive policy is retained.
  assert.equal(cache.has("https://example.com\nsearqonbot"), true);
});
