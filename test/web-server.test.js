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
