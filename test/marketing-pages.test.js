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
      ["/pricing/", "One intelligence layer."],
      ["/security/", "Security and trust"],
      ["/about/", "About Searqon"],
      ["/contact/", "Talk to the team"],
      ["/privacy/", "Privacy, explained"],
      ["/terms/", "Use the tools"]
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
    assert.equal(robotsText.includes("\\n"), false, "robots.txt contains a literal backslash-n sequence");
    const sitemap = await fetch(base + "/sitemap.xml");
    assert.equal(sitemap.status, 200);
    const xml = await sitemap.text();
    for (const route of ["/", "/product/", "/solutions/", "/methodology/", "/docs/", "/pricing/", "/security/", "/about/", "/contact/", "/privacy/", "/terms/"]) {
      assert.ok(xml.includes("https://searqon.tinlance.com" + route), "missing sitemap route " + route);
    }
    assert.equal(xml.includes("\\n"), false, "sitemap contains a literal backslash-n sequence");
    for (const route of ["/contact/", "/privacy/", "/terms/"]) {
      const entry = "<url><loc>https://searqon.tinlance.com" + route + "</loc></url>";
      assert.equal(xml.split(entry).length - 1, 1, "sitemap route must appear exactly once: " + route);
      assert.ok(xml.includes("\n  " + entry + "\n"), "sitemap route must be a distinct XML line: " + route);
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
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /fonts\.googleapis\.com/);
    assert.match(csp, /fonts\.gstatic\.com/);
    if (process.env.NODE_ENV !== "production") assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });
});


test("all internal links and static assets referenced by public pages resolve", async () => {
  await withServer(async base => {
    const pages = ["/", "/product/", "/solutions/", "/methodology/", "/docs/", "/pricing/", "/security/", "/about/", "/contact/", "/privacy/", "/terms/", "/auth/login/", "/auth/register/", "/404.html"];
    const references = new Set();
    for (const page of pages) {
      const response = await fetch(base + page);
      assert.equal(response.status, 200, page);
      const html = await response.text();
      for (const match of html.matchAll(/(?:href|src)="(\/[^\"#?]*)"/g)) {
        references.add(match[1]);
      }
    }
    for (const path of references) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, "broken internal reference " + path);
    }
  });
});


test("browser navigation to unknown public paths returns the branded 404 page", async () => {
  await withServer(async base => {
    const response = await fetch(base + "/this-page-does-not-exist", { headers: { accept: "text/html" } });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(await response.text(), /That page isn't here/);
    const head = await fetch(base + "/this-page-does-not-exist", { method: "HEAD", headers: { accept: "text/html" } });
    assert.equal(head.status, 404);
    assert.equal(await head.text(), "");
  });
});


test("public pages never expose escaped newline sequences as visible HTML text", async () => {
  await withServer(async base => {
    const routes = [
      "/", "/product/", "/solutions/", "/methodology/", "/docs/", "/pricing/",
      "/security/", "/about/", "/contact/", "/privacy/", "/terms/",
      "/auth/login/", "/auth/register/", "/auth/verify/", "/app/"
    ];
    for (const route of routes) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.equal(html.includes("\\n"), false, route + " contains a literal backslash-n sequence");
    }
  });
});
