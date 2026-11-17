import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../apps/web/server.js";

async function withServer(run) {
  const server = createAppServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("public marketing routes are real pages with a shared accessible navigation", async () => {
  await withServer(async base => {
    const routes = [
      ["/product/", "The Searqon platform"],
      ["/solutions/", "Built for teams"],
      ["/methodology/", "Evidence before conclusions"],
      ["/docs/", "Documentation"],
      ["/pricing/", "Pricing and early access"],
      ["/security/", "Security and trust"],
      ["/about/", "About Searqon"],\n      ["/contact/", "Talk to the team"],\n      ["/privacy/", "Privacy, explained"],\n      ["/terms/", "Use the tools"]
    ];
    for (const [path, heading] of routes) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /text\/html/);
      const html = await response.text();
      assert.match(html, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), path);
      assert.match(html, /Skip to content/, path);
      assert.match(html, /aria-label="Main navigation"/, path);
      assert.match(html, /\/pages\.css/, path);
      assert.match(html, /fonts\.googleapis\.com/, path);
      assert.match(html, new RegExp('rel="canonical" href="https://searqon\\.tinlance\\.com' + path.replaceAll("/", "\\/") + '"'), path);
    }
  });
});

test("homepage navigation resolves to real pages and does not use dead preview anchors", async () => {
  await withServer(async base => {
    const html = await fetch(base + "/").then(response => response.text());
    for (const href of ["/product/", "/solutions/", "/pricing/", "/docs/"]) {
      assert.ok(html.includes('href="' + href + '"'), "missing " + href);
    }
    assert.equal(/href="#(method|projects|agents)"/.test(html), false);
  });
});

test("marketing pages expose crawlable metadata and sitemap resources", async () => {
  await withServer(async base => {
    const robots = await fetch(base + "/robots.txt");
    assert.equal(robots.status, 200);
    const robotsText = await robots.text();
    assert.match(robotsText, /Sitemap:/);
    assert.match(robotsText, /Disallow: \/app\//);
    assert.match(robotsText, /Disallow: \/auth\//);
    const sitemap = await fetch(base + "/sitemap.xml");
    assert.equal(sitemap.status, 200);
    const xml = await sitemap.text();
    for (const route of ["/", "/product/", "/solutions/", "/methodology/", "/docs/", "/pricing/", "/security/", "/about/", "/contact/", "/privacy/", "/terms/"]) {
      assert.ok(xml.includes("https://searqon.tinlance.com" + route), "missing sitemap route " + route);
    }
    const llms = await fetch(base + "/llms.txt");
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get("content-type"), /text\/plain/);
    const llmsText = await llms.text();
    assert.match(llmsText, /early alpha; not production-ready/);
    assert.match(llmsText, /Live provider acquisition/);
  });
});

test("shared marketing styles preserve the brand palette and responsive layout", async () => {
  await withServer(async base => {
    const css = await fetch(base + "/pages.css").then(response => response.text());
    assert.match(css, /#12203A/);
    assert.match(css, /#F6F3EC/);
    assert.match(css, /#E8A33D/);
    assert.match(css, /@media\s*\(max-width:\s*720px\)/);
    assert.equal(/linear-gradient|radial-gradient|conic-gradient/i.test(css), false);
    const page = await fetch(base + "/product/");
    assert.match(page.headers.get("content-security-policy"), /fonts\.googleapis\.com/);
  });
});
