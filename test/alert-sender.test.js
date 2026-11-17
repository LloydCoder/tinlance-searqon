import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createAlertSender } from "../src/platform/alert-sender.js";

const EVENT_ID = "9d9e9c6e-6d25-4f65-9a7b-71f0c61f8d10";
const EVENT = Object.freeze({
  eventId: EVENT_ID,
  payload: {
    alertId: "alert-123",
    type: "brand_citation_change",
    metric: "brand_citation",
    direction: "decline",
    severity: "high",
    summary: "Brand citations declined",
    baselineId: "baseline-1",
    currentId: "current-1"
  }
});
const SLACK = "https://hooks.slack.com/services/T000/B000/secret";

function transport(response, seen = []) {
  return (url, options, callback) => {
    const request = new EventEmitter();
    const chunks = [];
    seen.push({ url: url.href, options, request });
    request.write = chunk => { chunks.push(Buffer.from(chunk)); return true; };
    request.end = () => {
      seen[seen.length - 1].body = Buffer.concat(chunks).toString("utf8");
      const incoming = response.stream ?? Readable.from([Buffer.from(response.body ?? "")]);
      incoming.statusCode = response.status ?? 200;
      incoming.headers = response.headers ?? {};
      process.nextTick(() => callback(incoming));
    };
    request.destroy = error => {
      if (error) process.nextTick(() => request.emit("error", error));
    };
    request.setTimeout = () => request;
    return request;
  };
}

const publicResolver = async hostname => {
  assert.equal(hostname, "hooks.slack.com");
  return [{ address: "13.107.42.14", family: 4 }];
};

test("Slack dispatch pins public DNS and emits a bounded, redacted message", async () => {
  const seen = [];
  const sender = createAlertSender({ resolver: publicResolver, requestImpl: transport({ status: 200, body: "ok" }, seen) });
  const result = await sender.send({ channel: "slack", secret: SLACK, event: EVENT });
  assert.equal(result.accepted, true);
  assert.equal(result.statusCode, 200);
  assert.equal(seen[0].url, SLACK);
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].options.agent, false);
  assert.equal(seen[0].options.headers["content-type"], "application/json");
  assert.match(seen[0].body, /Brand citations declined/);
  assert.doesNotMatch(seen[0].body, /secret/);
  await new Promise((resolve, reject) => seen[0].options.lookup("hooks.slack.com", { family: 4 }, (error, address) => {
    if (error) return reject(error);
    try { assert.equal(address, "13.107.42.14"); resolve(); } catch (failure) { reject(failure); }
  }));
});

test("PagerDuty uses a fixed endpoint and a stable event deduplication key", async () => {
  const seen = [];
  const sender = createAlertSender({
    resolver: async hostname => {
      assert.equal(hostname, "events.pagerduty.com");
      return [{ address: "13.107.42.14", family: 4 }];
    },
    requestImpl: transport({ status: 202, body: JSON.stringify({ status: "success", dedup_key: EVENT_ID }) }, seen)
  });
  const result = await sender.send({ channel: "pagerduty", secret: "A".repeat(32), event: EVENT });
  const body = JSON.parse(seen[0].body);
  assert.equal(seen[0].url, "https://events.pagerduty.com/v2/enqueue");
  assert.equal(body.routing_key, "A".repeat(32));
  assert.equal(body.dedup_key, EVENT_ID);
  assert.equal(body.event_action, "trigger");
  assert.equal(result.accepted, true);
});

test("dispatch rejects a private DNS answer before opening a socket", async () => {
  let requests = 0;
  const sender = createAlertSender({
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    requestImpl: (...args) => { requests++; return transport({ status: 200, body: "ok" })(...args); }
  });
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT }),
    error => error.code === "unsafe_destination"
  );
  assert.equal(requests, 0);
});

test("dispatch never follows provider redirects", async () => {
  const sender = createAlertSender({
    resolver: publicResolver,
    requestImpl: transport({ status: 302, headers: { location: "https://attacker.example/collect" } })
  });
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT }),
    error => error.code === "provider_redirect"
  );
});

test("dispatch rejects unsuccessful provider responses without exposing response bodies", async () => {
  const sender = createAlertSender({
    resolver: publicResolver,
    requestImpl: transport({ status: 500, body: "private-provider-diagnostic" })
  });
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT }),
    error => error.code === "provider_unavailable" && !error.message.includes("private-provider-diagnostic")
  );
});

test("PagerDuty rejects a 2xx response that does not confirm acceptance", async () => {
  const sender = createAlertSender({
    resolver: async () => [{ address: "13.107.42.14", family: 4 }],
    requestImpl: transport({ status: 202, body: JSON.stringify({ status: "invalid event" }) })
  });
  await assert.rejects(
    sender.send({ channel: "pagerduty", secret: "A".repeat(32), event: EVENT }),
    error => error.code === "provider_rejected"
  );
});

test("dispatch validates event identity and honors cancellation before network access", async () => {
  let requests = 0;
  const sender = createAlertSender({
    resolver: publicResolver,
    requestImpl: (...args) => { requests++; return transport({ status: 200, body: "ok" })(...args); }
  });
  await assert.rejects(sender.send({ channel: "slack", secret: SLACK, event: { ...EVENT, eventId: "bad" } }), /event/i);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT, signal: controller.signal }),
    error => error.code === "dispatch_aborted"
  );
  assert.equal(requests, 0);
});


test("dispatch enforces a response-body byte ceiling", async () => {
  const sender = createAlertSender({
    resolver: publicResolver,
    maxResponseBytes: 8,
    requestImpl: transport({ status: 200, body: "provider response is too large" })
  });
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT }),
    error => error.code === "provider_response_too_large"
  );
});

test("dispatch deadline covers a provider that never finishes its response body", async () => {
  const stream = new Readable({ read() {} });
  const sender = createAlertSender({
    resolver: publicResolver,
    timeoutMs: 100,
    requestImpl: transport({ status: 200, stream })
  });
  await assert.rejects(
    sender.send({ channel: "slack", secret: SLACK, event: EVENT }),
    error => error.code === "provider_timeout"
  );
});

test("worker cancellation interrupts a provider response body read", async () => {
  const stream = new Readable({ read() {} });
  const controller = new AbortController();
  const sender = createAlertSender({
    resolver: publicResolver,
    timeoutMs: 1000,
    requestImpl: transport({ status: 200, stream })
  });
  const pending = sender.send({ channel: "slack", secret: SLACK, event: EVENT, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, error => error.code === "dispatch_aborted");
});
