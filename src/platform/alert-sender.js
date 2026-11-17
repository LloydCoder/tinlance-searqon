import https from "node:https";
import { resolvePublicHost, createPinnedLookup } from "../security/url-policy.js";
import { validateAlertDestinationSecret } from "./alert-destinations.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT = /^[A-Za-z0-9._:-]{1,160}$/;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DNS_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 4096;
const MAX_REQUEST_BYTES = 16 * 1024;
const PAGERDUTY_URL = new URL("https://events.pagerduty.com/v2/enqueue");

export class AlertDispatchError extends Error {
  constructor(statusCode, code, message, { retryable = false } = {}) {
    super(message);
    this.name = "AlertDispatchError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function boundedInteger(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(name + " must be an integer between " + min + " and " + max + ".");
  }
  return value;
}

function safeText(value, maximum = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || !UUID.test(event.eventId ?? "")) {
    throw new AlertDispatchError(400, "invalid_event", "A persisted alert event with a valid identifier is required.");
  }
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new AlertDispatchError(400, "invalid_event", "The persisted alert event payload is invalid.");
  }
  const payload = event.payload;
  const summary = safeText(payload.summary || payload.title || (safeText(payload.type, 80) + ": " + safeText(payload.metric, 80) + " " + safeText(payload.direction, 40)));
  if (!summary) throw new AlertDispatchError(400, "invalid_event", "The alert event does not contain a usable summary.");
  const severity = ["low", "medium", "high"].includes(payload.severity) ? payload.severity : "medium";
  const details = Object.create(null);
  for (const key of ["alertId", "type", "metric", "direction", "baselineId", "currentId", "baselineAt", "currentAt"]) {
    const value = safeText(payload[key], 128);
    if (value) details[key] = value;
  }
  return Object.freeze({
    eventId: event.eventId,
    summary,
    severity,
    details: Object.freeze(details)
  });
}

function providerRequest(channel, secret, event) {
  if (channel === "pagerduty") {
    return {
      url: PAGERDUTY_URL,
      body: {
        routing_key: secret,
        event_action: "trigger",
        dedup_key: event.eventId,
        payload: {
          summary: "Searqon: " + event.summary,
          source: "Searqon",
          severity: event.severity === "high" ? "error" : event.severity === "medium" ? "warning" : "info",
          custom_details: { event_id: event.eventId, ...event.details }
        }
      }
    };
  }
  const url = new URL(validateAlertDestinationSecret(channel, secret));
  if (channel === "slack") {
    return {
      url,
      body: {
        text: "Searqon alert — " + event.summary + "\nSeverity: " + event.severity + "\nEvent: " + event.eventId
      }
    };
  }
  return {
    url,
    body: {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: "Searqon alert", weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text: event.summary, wrap: true },
            { type: "FactSet", facts: [
              { title: "Severity", value: event.severity },
              { title: "Event", value: event.eventId }
            ] }
          ]
        }
      }]
    }
  };
}

async function readResponse(response, maximumBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximumBytes) {
      response.destroy?.();
      throw new AlertDispatchError(502, "provider_response_too_large", "The alert provider response exceeded its size limit.", { retryable: false });
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function receiptId(headers) {
  for (const name of ["x-request-id", "x-slack-req-id", "x-pagerduty-request-id"]) {
    const value = headers?.[name];
    if (typeof value === "string" && RECEIPT.test(value)) return value;
  }
  return null;
}

export function createAlertSender({
  resolver,
  requestImpl = (url, options, callback) => https.request(url, options, callback),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dnsTimeoutMs = DEFAULT_DNS_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES
} = {}) {
  if (typeof requestImpl !== "function") throw new TypeError("A HTTPS request implementation is required.");
  boundedInteger(timeoutMs, "timeoutMs", 100, 30000);
  boundedInteger(dnsTimeoutMs, "dnsTimeoutMs", 100, 10000);
  boundedInteger(maxResponseBytes, "maxResponseBytes", 1, 16384);

  return Object.freeze({
    async send({ channel, secret, event, signal } = {}) {
      if (signal?.aborted) throw new AlertDispatchError(499, "dispatch_aborted", "Alert dispatch was cancelled.");
      const normalizedEvent = validateEvent(event);
      if (!["slack", "teams", "pagerduty"].includes(channel)) {
        throw new AlertDispatchError(400, "unsupported_channel", "The alert destination channel is not supported.");
      }
      let request;
      try {
        const target = providerRequest(channel, secret, normalizedEvent);
        if (target.url.protocol !== "https:" || (target.url.port && target.url.port !== "443")) {
          throw new AlertDispatchError(400, "unsafe_destination", "Alert destinations must use HTTPS on the standard port.");
        }
        let dnsTimer;
        let addresses;
        try {
          addresses = await Promise.race([
            resolvePublicHost(target.url.hostname, resolver),
            new Promise((_, reject) => {
              dnsTimer = setTimeout(() => reject(new AlertDispatchError(503, "dns_timeout", "Alert provider DNS resolution timed out.", { retryable: true })), dnsTimeoutMs);
            })
          ]);
        } catch (error) {
          if (error instanceof AlertDispatchError) throw error;
          throw new AlertDispatchError(400, "unsafe_destination", "The alert provider hostname did not resolve exclusively to public addresses.");
        } finally {
          clearTimeout(dnsTimer);
        }
        if (signal?.aborted) throw new AlertDispatchError(499, "dispatch_aborted", "Alert dispatch was cancelled.");
        const lookup = createPinnedLookup(target.url.hostname, addresses);
        const body = Buffer.from(JSON.stringify(target.body), "utf8");
        if (body.length > MAX_REQUEST_BYTES) throw new AlertDispatchError(413, "dispatch_payload_too_large", "The alert provider payload exceeds its size limit.");
        const options = {
          method: "POST",
          agent: false,
          lookup,
          servername: target.url.hostname,
          maxHeaderSize: 8192,
          headers: {
            accept: "application/json, text/plain",
            "content-type": "application/json",
            "content-length": String(body.length),
            "user-agent": "Searqon-Alert-Dispatcher/1.0"
          }
        };
        const response = await new Promise((resolve, reject) => {
          let settled = false;
          let timer;
          const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve(value);
          };
          const abort = () => {
            const error = new AlertDispatchError(499, "dispatch_aborted", "Alert dispatch was cancelled.");
            request?.destroy(error);
            finish(error);
          };
          try {
            request = requestImpl(target.url, options, incoming => finish(null, incoming));
            request.once("error", error => finish(new AlertDispatchError(503, "provider_unavailable", "The alert provider could not be reached.", { retryable: true })));
            timer = setTimeout(() => {
              const error = new AlertDispatchError(504, "provider_timeout", "The alert provider request timed out.", { retryable: true });
              request.destroy(error);
              finish(error);
            }, timeoutMs);
            signal?.addEventListener("abort", abort, { once: true });
            request.write(body);
            request.end();
          } catch {
            finish(new AlertDispatchError(503, "provider_unavailable", "The alert provider request could not be started.", { retryable: true }));
          }
        });
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy?.();
          throw new AlertDispatchError(502, "provider_redirect", "Alert provider redirects are not followed.", { retryable: false });
        }
        const responseBody = await readResponse(response, maxResponseBytes);
        if (status === 429 || status >= 500) {
          throw new AlertDispatchError(503, "provider_unavailable", "The alert provider is temporarily unavailable.", { retryable: true });
        }
        if (status < 200 || status >= 300) {
          throw new AlertDispatchError(502, "provider_rejected", "The alert provider rejected the notification.", { retryable: false });
        }
        if (channel === "pagerduty") {
          let parsed;
          try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
          if (!parsed || parsed.status !== "success") {
            throw new AlertDispatchError(502, "provider_rejected", "PagerDuty did not confirm event acceptance.", { retryable: false });
          }
        }
        return Object.freeze({
          accepted: true,
          statusCode: status,
          providerReceiptId: receiptId(response.headers)
        });
      } catch (error) {
        if (error instanceof AlertDispatchError) throw error;
        throw new AlertDispatchError(503, "provider_unavailable", "The alert provider request failed.", { retryable: true });
      }
    }
  });
}
