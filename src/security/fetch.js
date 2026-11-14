import http from "node:http";
import https from "node:https";
import { resolvePublicHost, createPinnedLookup, validateTargetUrl, resolveRedirectTarget } from "./url-policy.js";

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function validateBound(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + " must be an integer between " + minimum + " and " + maximum);
  }
  return value;
}

function validatePort(target) {
  const expected = target.protocol === "https:" ? "443" : "80";
  if (target.port && target.port !== expected) {
    throw new TypeError("Only standard HTTP and HTTPS ports 80 and 443 are permitted");
  }
}

/**
 * Fetch one public HTTP(S) resource with DNS pinning and bounded response reads.
 * Redirects are handled manually so every hop is revalidated and re-resolved.
 * No caller-supplied headers, credentials, cookies, or request bodies are accepted.
 */
export async function fetchPublicUrl(value, options = {}) {
  const maxBytes = validateBound(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes", 1, 10 * 1024 * 1024);
  const timeoutMs = validateBound(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 100, 30_000);
  const maxRedirects = validateBound(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS, "maxRedirects", 0, 5);
  const dnsTimeoutMs = validateBound(options.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS, "dnsTimeoutMs", 100, 10_000);
  const resolver = options.resolver;
  const requestImpl = options.requestImpl ?? ((url, requestOptions, callback) =>
    (url.protocol === "https:" ? https : http).request(url, requestOptions, callback));
  if (typeof requestImpl !== "function") throw new TypeError("requestImpl must be a function");

  let current = validateTargetUrl(value);
  let redirects = 0;

  while (true) {
    validatePort(current);
    let dnsTimer;
    let addresses;
    try {
      addresses = await Promise.race([
        resolvePublicHost(current.hostname, resolver),
        new Promise((_, reject) => {
          dnsTimer = setTimeout(() => reject(new Error("DNS resolution timed out")), dnsTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(dnsTimer);
    }
    const lookup = createPinnedLookup(current.hostname, addresses);
    const url = new URL(current.href);
    const requestOptions = {
      method: "GET",
      agent: false,
      lookup,
      maxHeaderSize: 16 * 1024,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/json,text/markdown;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        "user-agent": "Searqon-Scanner/0.1 (+https://github.com/LloydCoder/tinlance-searqon)"
      }
    };

    const response = await new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try {
        request = requestImpl(url, requestOptions, incoming => {
          if (settled) {
            incoming.destroy();
            return;
          }
          settled = true;
          resolve({ incoming, request });
        });
        request.once("error", fail);
        request.setTimeout?.(timeoutMs, () => request.destroy(new Error("HTTP acquisition timed out")));
        request.end();
      } catch (error) {
        fail(error);
      }
    });

    const { incoming, request } = response;
    const status = incoming.statusCode ?? 0;
    const headers = incoming.headers ?? {};

    if (REDIRECT_STATUSES.has(status) && headers.location) {
      incoming.destroy();
      if (redirects >= maxRedirects) throw new Error("HTTP acquisition redirect limit exceeded");
      const next = resolveRedirectTarget(current.href, headers.location);
      if (current.protocol === "https:" && next.protocol === "http:") {
        throw new Error("HTTPS-to-HTTP redirect downgrade is not permitted");
      }
      current = next;
      redirects++;
      continue;
    }

    const encoding = String(headers["content-encoding"] ?? "identity").toLowerCase();
    if (encoding !== "identity") {
      incoming.destroy();
      request.destroy();
      throw new Error("HTTP acquisition rejected unexpected content encoding");
    }

    const declaredLength = headers["content-length"];
    if (declaredLength !== undefined) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0) {
        incoming.destroy();
        request.destroy();
        throw new Error("HTTP acquisition received an invalid content length");
      }
      if (length > maxBytes) {
        incoming.destroy();
        request.destroy();
        throw new RangeError("HTTP acquisition response exceeds the configured byte limit");
      }
    }

    const chunks = [];
    let byteLength = 0;
    try {
      for await (const chunk of incoming) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += buffer.length;
        if (byteLength > maxBytes) {
          incoming.destroy();
          request.destroy();
          throw new RangeError("HTTP acquisition response exceeds the configured byte limit");
        }
        chunks.push(buffer);
      }
    } catch (error) {
      request.destroy();
      throw error;
    }

    return Object.freeze({
      status,
      headers: Object.freeze({ ...headers }),
      body: Buffer.concat(chunks, byteLength),
      finalUrl: current.href,
      redirects,
      byteLength
    });
  }
}
