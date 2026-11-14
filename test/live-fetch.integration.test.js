import test from "node:test";
import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { fetchPublicUrl } from "../src/security/fetch.js";

const inGitHubActions = process.env.GITHUB_ACTIONS === "true";

test("real HTTPS request uses a validated pinned IPv4 address and verifies TLS", { skip: !inGitHubActions }, async () => {
  const ipv4Resolver = hostname => lookup(hostname, { all: true, family: 4, verbatim: true });
  const response = await fetchPublicUrl("https://example.com/", {
    resolver: ipv4Resolver,
    timeoutMs: 15_000,
    dnsTimeoutMs: 5_000,
    maxBytes: 128 * 1024,
    maxRedirects: 1
  });
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/i);
  assert.match(response.body.toString("utf8"), /Example Domain/);
  assert.equal(response.redirects, 0);
  assert.ok(response.byteLength > 0 && response.byteLength <= 128 * 1024);
});
