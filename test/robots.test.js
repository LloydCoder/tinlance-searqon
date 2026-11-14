import test from "node:test";
import assert from "node:assert/strict";
import { parseRobots, evaluateRobots } from "../src/security/robots.js";

test("robots parser groups user agents and directives", () => {
  const robots=parseRobots("User-agent: SearqonBot\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\nSitemap: https://example.com/sitemap.xml\n");
  assert.equal(robots.groups.length,1);
  assert.deepEqual(robots.groups[0].userAgents,["searqonbot"]);
  assert.equal(robots.groups[0].rules.length,2);
  assert.equal(robots.groups[0].crawlDelay,2);
  assert.deepEqual(robots.sitemaps,["https://example.com/sitemap.xml"]);
});

test("longest matching path rule wins and allow wins equal-length ties", () => {
  const robots=parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /same\nAllow: /same\n");
  assert.equal(evaluateRobots(robots,"https://example.com/private/a","SearqonBot").allowed,false);
  assert.equal(evaluateRobots(robots,"https://example.com/private/public/a","SearqonBot").allowed,true);
  assert.equal(evaluateRobots(robots,"https://example.com/same","SearqonBot").allowed,true);
});

test("specific user-agent groups override wildcard groups", () => {
  const robots=parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: SearqonBot\nAllow: /public\n");
  assert.equal(evaluateRobots(robots,"https://example.com/public","SearqonBot").allowed,true);
  assert.equal(evaluateRobots(robots,"https://example.com/private","SearqonBot").allowed,true);
  assert.equal(evaluateRobots(robots,"https://example.com/public","OtherBot").allowed,false);
});

test("matching user-agent groups with the same most-specific token are merged", () => {
  const robots=parseRobots("User-agent: Searqon\nDisallow: /private\n\nUser-agent: Searqon\nAllow: /private/public\n");
  assert.equal(evaluateRobots(robots,"https://example.com/private","SearqonBot").allowed,false);
  assert.equal(evaluateRobots(robots,"https://example.com/private/public","SearqonBot").allowed,true);
});

test("wildcards and end anchors are supported", () => {
  const robots=parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/secret\n");
  assert.equal(evaluateRobots(robots,"https://example.com/report.pdf","SearqonBot").allowed,false);
  assert.equal(evaluateRobots(robots,"https://example.com/report.pdf?download=1","SearqonBot").allowed,true);
  assert.equal(evaluateRobots(robots,"https://example.com/tmp/a/secret","SearqonBot").allowed,false);
});

test("comments, empty disallow values and malformed records are handled safely", () => {
  const robots=parseRobots("# comment\nUser-agent: *\nDisallow: # empty rule\nUnknown: ignored\nAllow: /ok # comment\n");
  assert.equal(robots.groups[0].rules.length,1);
  assert.equal(evaluateRobots(robots,"https://example.com/ok","SearqonBot").allowed,true);
  assert.equal(evaluateRobots(robots,"https://example.com/other","SearqonBot").allowed,true);
});

test("robots parser rejects oversized input and evaluation rejects invalid URLs", () => {
  assert.throws(()=>parseRobots("x".repeat(512*1024+1)),/size limit/);
  assert.throws(()=>evaluateRobots(parseRobots("User-agent: *"),"not a URL","Bot"),/valid URL/);
});


test("robots matching normalizes UTF-8 paths to percent-encoded octets", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /caf\u00e9");
  assert.equal(evaluateRobots(robots, "https://example.com/caf%C3%A9", "SearqonBot").allowed, false);
});

test("robots matching decodes percent-encoded unreserved octets before comparison", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /foo/%62ar");
  assert.equal(evaluateRobots(robots, "https://example.com/foo/bar", "SearqonBot").allowed, false);
});

test("robots matching preserves percent-encoded reserved octets and normalizes hex case", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /foo%2fbar");
  assert.equal(evaluateRobots(robots, "https://example.com/foo%2Fbar", "SearqonBot").allowed, false);
  assert.equal(evaluateRobots(robots, "https://example.com/foo/bar", "SearqonBot").allowed, true);
});

test("robots specificity counts normalized octets rather than percent-escape characters", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /foo/%62\nAllow: /foo/b");
  assert.equal(evaluateRobots(robots, "https://example.com/foo/b", "SearqonBot").allowed, true);
});


test("robots matching does not reinterpret percent-encoded reserved metacharacters", () => {
  const robots = parseRobots("User-agent: *\\nDisallow: /literal%2Astar\\nDisallow: /exact%24");
  assert.equal(evaluateRobots(robots, "https://example.com/literal%2Astar", "SearqonBot").allowed, false);
  assert.equal(evaluateRobots(robots, "https://example.com/literalXstar", "SearqonBot").allowed, true);
  assert.equal(evaluateRobots(robots, "https://example.com/exact%24", "SearqonBot").allowed, false);
  assert.equal(evaluateRobots(robots, "https://example.com/exact", "SearqonBot").allowed, true);
});
