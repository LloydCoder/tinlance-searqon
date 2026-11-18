import { fetchPublicUrl } from "./fetch.js";
import { validateTargetUrl } from "./url-policy.js";
import { parseRobots } from "./robots.js";
import { wireUserAgent } from "./user-agent.js";

const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SUCCESS_TTL_MS = 60 * 60 * 1000;
const DEFAULT_FAILURE_TTL_MS = 30 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 1024;
const DISALLOW_ALL = parseRobots("User-agent: *\nDisallow: /");
const ALLOW_ALL = parseRobots("");
const defaultCache = new Map();

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function cacheControl(headers) {
  const value = headerValue(headers, "cache-control");
  return typeof value === "string" ? value.toLowerCase().split(",").map(item => item.trim()) : [];
}

function retryAfterMs(headers, now) {
  const value = headerValue(headers, "retry-after");
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Math.min(Number(value.trim()) * 1000, MAX_CACHE_TTL_MS);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - now), MAX_CACHE_TTL_MS) : null;
}

function cacheTtl(headers, status, now) {
  const directives = cacheControl(headers);
  if (directives.includes("no-store") || directives.includes("no-cache")) return 0;
  const maxAge = directives.find(item => /^max-age=\d+$/.test(item));
  if (maxAge) return Math.min(Number(maxAge.slice(8)) * 1000, MAX_CACHE_TTL_MS);
  const expires = headerValue(headers, "expires");
  if (typeof expires === "string") {
    const parsed = Date.parse(expires);
    if (Number.isFinite(parsed)) return Math.min(Math.max(0, parsed - now), MAX_CACHE_TTL_MS);
  }
  if (!Number.isInteger(status) || status < 200 || (status >= 300 && status < 400) || status === 429 || status >= 500) {
    return retryAfterMs(headers, now) ?? DEFAULT_FAILURE_TTL_MS;
  }
  return DEFAULT_SUCCESS_TTL_MS;
}

function immutableResult(data) {
  return Object.freeze({ ...data });
}

/**
 * Retrieve and cache robots policy for one public origin.
 * RFC 9309's unavailable 4xx response is represented as an empty policy;
 * server/network failures fail closed with Disallow: /.
 */
export async function fetchRobotsPolicy(origin, userAgent, options = {}) {
  if (typeof userAgent !== "string" || !userAgent.trim() || userAgent.length > 256) {
    throw new TypeError("A crawler user-agent token of at most 256 characters is required");
  }
  wireUserAgent(userAgent);
  const target = validateTargetUrl(origin);
  const originUrl = new URL(target.href);
  const originKey = originUrl.origin;
  const sourceUrl = new URL("/robots.txt", originKey).href;
  const cache = options.cache ?? defaultCache;
  if (!(cache instanceof Map)) throw new TypeError("cache must be a Map");
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
    throw new RangeError("maxEntries must be an integer between 1 and 10000");
  }
  const clock = options.now ?? Date.now;
  if (typeof clock !== "function") throw new TypeError("now must be a clock function");
  const now = clock();
  if (!Number.isFinite(now)) throw new TypeError("clock must return a finite timestamp");

  const cacheKey = originKey + "\n" + userAgent.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt !== null && cached.expiresAt > now) {
    return immutableResult({ ...cached, cacheHit: true });
  }
  if (cached) cache.delete(cacheKey);

  const fetcher = options.fetcher ?? fetchPublicUrl;
  if (typeof fetcher !== "function") throw new TypeError("fetcher must be a function");

  let status = null;
  let headers = {};
  let finalUrl = sourceUrl;
  let redirects = 0;
  let outcome = "unreachable";
  let policy = DISALLOW_ALL;
  let error = null;

  try {
    const response = await fetcher(sourceUrl, {
      maxBytes: MAX_ROBOTS_BYTES,
      maxRedirects: 5,
      timeoutMs: options.timeoutMs ?? 10_000,
      dnsTimeoutMs: options.dnsTimeoutMs ?? 5_000,
      userAgent,
      validateRedirect: ({ to }) => {
        try { return new URL(to).origin === originKey; }
        catch { return false; }
      }
    });
    status = response.status;
    headers = response.headers ?? {};
    finalUrl = response.finalUrl ?? sourceUrl;
    redirects = response.redirects ?? 0;
    if (new URL(finalUrl).origin !== originKey) {
      throw new Error("Cross-origin robots.txt redirect is not permitted");
    }

    if (Number.isInteger(status) && status >= 200 && status < 300) {
      const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? "");
      if (body.length > MAX_ROBOTS_BYTES) throw new RangeError("robots.txt exceeds the 512 KiB retrieval size limit");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      policy = parseRobots(text);
      outcome = "available";
    } else if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 429) {
      policy = ALLOW_ALL;
      outcome = "unavailable";
    } else {
      policy = DISALLOW_ALL;
      outcome = "unreachable";
    }
  } catch (cause) {
    policy = DISALLOW_ALL;
    outcome = "unreachable";
    error = cause instanceof Error ? cause.message.slice(0, 256) : "Robots retrieval failed";
  }

  const ttl = cacheTtl(headers, status, now);
  const expiresAt = ttl > 0 ? now + ttl : null;
  const result = immutableResult({
    origin: originKey,
    sourceUrl,
    finalUrl,
    status,
    outcome,
    policy,
    redirects,
    error,
    fetchedAt: now,
    expiresAt,
    cacheHit: false
  });

  if (expiresAt !== null) {
    cache.set(cacheKey, result);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  return result;
}
