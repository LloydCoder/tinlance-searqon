import { analyzeDocument } from "./analyzer.js";
import { fetchPublicUrl } from "./security/fetch.js";
import { fetchRobotsPolicy } from "./security/robots-fetch.js";
import { validateTargetUrl } from "./security/url-policy.js";
import { evaluateRobots } from "./security/robots.js";

const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT = "SearqonBot";

function publicLabel(value) {
  const url = new URL(value);
  return url.origin + url.pathname;
}

function mediaType(headers) {
  const value = headers?.["content-type"];
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function toAnalyzerType(value) {
  if (value === "application/xhtml+xml") return "text/html";
  if (["text/html", "text/markdown", "application/json", "application/vnd.oai.openapi+json"].includes(value)) return value;
  return null;
}

function result(status, data = {}) {
  return Object.freeze({ schemaVersion: "1.0.0", status, ...data });
}

function evaluatePolicy(policyResult, url, userAgent) {
  if (!policyResult || !["available", "unavailable"].includes(policyResult.outcome) || !policyResult.policy) {
    return { outcome: "unreachable", allowed: false };
  }
  try {
    return { outcome: policyResult.outcome, allowed: evaluateRobots(policyResult.policy, url, userAgent).allowed };
  } catch {
    return { outcome: "unreachable", allowed: false };
  }
}

/**
 * Scan exactly one caller-selected public URL. The target is never expanded
 * into a recursive crawl and every redirect destination is checked against
 * that destination's robots policy before the next connection is opened.
 */
export async function scanPublicUrl(value, options = {}) {
  const target = validateTargetUrl(value);
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  if (typeof userAgent !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(userAgent)) {
    throw new TypeError("userAgent must be a crawler product token of 1-64 ASCII letters, digits, underscores, or hyphens");
  }
  const maxBytes = options.maxBytes ?? MAX_SCAN_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SCAN_BYTES) {
    throw new RangeError("maxBytes must be between 1 byte and 2 MiB");
  }
  const maxRedirects = options.maxRedirects ?? 3;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5) {
    throw new RangeError("maxRedirects must be between 0 and 5");
  }
  const robotsLoader = options.robotsLoader ?? fetchRobotsPolicy;
  const fetcher = options.fetcher ?? fetchPublicUrl;
  if (typeof robotsLoader !== "function" || typeof fetcher !== "function") throw new TypeError("robotsLoader and fetcher must be functions");

  const origin = new URL(target.href).origin;
  const robotsOptions = {
    cache: options.robotsCache,
    timeoutMs: options.timeoutMs,
    dnsTimeoutMs: options.dnsTimeoutMs
  };

  let initialRobots;
  try {
    initialRobots = await robotsLoader(origin, userAgent, robotsOptions);
  } catch {
    return result("robots_unreachable", { target: publicLabel(target.href), robotsOutcome: "unreachable" });
  }
  const initialDecision = evaluatePolicy(initialRobots, target.href, userAgent);
  if (initialDecision.outcome === "unreachable") {
    return result("robots_unreachable", {
      target: publicLabel(target.href),
      robotsOutcome: "unreachable",
      robotsStatus: initialRobots?.status ?? null
    });
  }
  if (!initialDecision.allowed) {
    return result("blocked_by_robots", {
      target: publicLabel(target.href),
      robotsOutcome: initialDecision.outcome,
      robotsStatus: initialRobots?.status ?? null
    });
  }

  let redirectBlockReason = null;
  const validateRedirect = async ({ to }) => {
    try {
      const destination = validateTargetUrl(to);
      const destinationOrigin = new URL(destination.href).origin;
      const destinationRobots = await robotsLoader(destinationOrigin, userAgent, robotsOptions);
      const decision = evaluatePolicy(destinationRobots, destination.href, userAgent);
      if (decision.outcome === "unreachable") {
        redirectBlockReason = "robots_unreachable";
        return false;
      }
      if (!decision.allowed) {
        redirectBlockReason = "robots_disallowed";
        return false;
      }
      return true;
    } catch {
      redirectBlockReason = "robots_unreachable";
      return false;
    }
  };

  let response;
  try {
    response = await fetcher(target.href, {
      maxBytes,
      maxRedirects,
      timeoutMs: options.timeoutMs ?? 10_000,
      dnsTimeoutMs: options.dnsTimeoutMs ?? 5_000,
      validateRedirect
    });
  } catch (error) {
    if (error?.code === "ERR_REDIRECT_POLICY") {
      const status = redirectBlockReason === "robots_unreachable" ? "robots_unreachable" : "blocked_by_robots";
      return result(status, {
        target: publicLabel(target.href),
        robotsOutcome: redirectBlockReason ?? "unreachable"
      });
    }
    return result("fetch_failed", {
      target: publicLabel(target.href),
      error: error instanceof Error ? error.message.slice(0, 256) : "HTTP acquisition failed"
    });
  }

  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    return result("fetch_failed", {
      target: publicLabel(target.href),
      responseStatus: response.status ?? null
    });
  }

  const type = mediaType(response.headers);
  const analyzerType = toAnalyzerType(type);
  if (!analyzerType) {
    return result("unsupported_content_type", {
      target: publicLabel(target.href),
      responseStatus: response.status,
      contentType: type || null
    });
  }

  const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? "");
  if (body.length > maxBytes) {
    return result("fetch_failed", { target: publicLabel(target.href), error: "Response exceeded the configured scan size limit" });
  }

  let assessment;
  try {
    const collectedAt = options.now ? options.now() : new Date().toISOString();
    assessment = analyzeDocument({
      source: publicLabel(response.finalUrl ?? target.href),
      contentType: analyzerType,
      content: new TextDecoder("utf-8").decode(body),
      acquisitionMethod: "http_get",
      observationClass: "crawl",
      collectedAt
    });
  } catch (error) {
    return result("analysis_failed", {
      target: publicLabel(target.href),
      responseStatus: response.status,
      contentType: type,
      error: error instanceof Error ? error.message.slice(0, 256) : "Document analysis failed"
    });
  }

  return result("scanned", {
    target: publicLabel(target.href),
    finalUrl: publicLabel(response.finalUrl ?? target.href),
    robotsOutcome: initialRobots.outcome,
    responseStatus: response.status,
    contentType: type,
    redirects: response.redirects ?? 0,
    assessment
  });
}
