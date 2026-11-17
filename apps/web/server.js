import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeDocument } from "../../src/analyzer.js";
import { createDatabase } from "../../src/platform/database.js";
import { createAuthService } from "../../src/platform/auth.js";
import { createEmailSender } from "../../src/platform/email.js";
import { createWorkspaceService } from "../../src/platform/workspaces.js";
import { createRecommendationService } from "../../src/platform/recommendations.js";
import { createGeoObservationService } from "../../src/platform/geo-observations.js";

const ROOT = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const MAX_BODY_BYTES = 2 * 1024 * 1024 + 8192;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/markdown", "application/json"]);
const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
});

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function applySecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  if (process.env.NODE_ENV === "production") response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' https://fonts.googleapis.com",
    "script-src 'self'",
    "connect-src 'self'"
  ];
  if (process.env.NODE_ENV === "production") contentSecurityPolicy.push("upgrade-insecure-requests");
  response.setHeader("content-security-policy", contentSecurityPolicy.join("; "));
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("request body exceeds the configured limit");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}


function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-searqon_session" : "searqon_session";
}
function readSessionCookie(request) {
  const header = request.headers.cookie;
  if (typeof header !== "string") return null;
  const name = sessionCookieName();
  const matches = header.split(";").map(part => part.trim()).filter(part => part.startsWith(name + "="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function writeSessionCookie(response, token, expiresAt) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  response.setHeader("set-cookie", sessionCookieName() + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : ""));
}
function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production";
  response.setHeader("set-cookie", sessionCookieName() +
    "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : ""));
}
function isSameOrigin(request, expectedOrigin) {
  return typeof request.headers.origin === "string" && request.headers.origin === expectedOrigin;
}
function requireJsonContentType(request, response) {
  if (/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) return true;
  sendJson(response, 415, { error: { code: "unsupported_media_type", message: "Send an application/json request body." } });
  return false;
}

function validateAssessmentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error("request body must be a JSON object");
    error.statusCode = 400;
    throw error;
  }
  const source = input.source === undefined ? "user-supplied-document" : input.source;
  if (typeof source !== "string" || source.trim().length === 0 || source.length > 512) {
    const error = new Error("source must be a non-empty label of at most 512 characters");
    error.statusCode = 400;
    throw error;
  }
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    const error = new Error("contentType must be text/html, text/markdown, or application/json");
    error.statusCode = 415;
    error.code = "unsupported_media_type";
    throw error;
  }
  if (typeof input.content !== "string") {
    const error = new Error("content must be a string");
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_DOCUMENT_BYTES) {
    const error = new Error("document exceeds the 2 MiB analysis limit");
    error.statusCode = 413;
    throw error;
  }
  return { source: source.trim(), contentType: input.contentType, content: input.content };
}

async function sendStaticNotFound(response, headOnly, acceptsHtml) {
  if (acceptsHtml) {
    try {
      const body = await readFile(resolve(ROOT, "404.html"));
      response.writeHead(404, {
        "content-type": "text/html; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-cache"
      });
      response.end(headOnly ? undefined : body);
      return;
    } catch {
      // Fall through to the structured response if the custom page is unavailable.
    }
  }
  sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
}

async function serveStatic(pathname, response, headOnly = false, acceptsHtml = false) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: { code: "bad_path", message: "Invalid URL path." } });
    return;
  }

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let candidate = resolve(ROOT, relative);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) {
    sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
    return;
  }

  try {
    let info = await stat(candidate);
    if (info.isDirectory()) {
      candidate = resolve(candidate, "index.html");
      info = await stat(candidate);
    }
    if (!info.isFile()) throw new Error("not a file");

    const rootRealPath = await realpath(ROOT);
    const fileRealPath = await realpath(candidate);
    if (fileRealPath !== rootRealPath && !fileRealPath.startsWith(rootRealPath + sep)) {
      sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
      return;
    }

    const extension = extname(fileRealPath).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) {
      await sendStaticNotFound(response, headOnly, acceptsHtml);
      return;
    }
    const body = await readFile(fileRealPath);
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });
    response.end(headOnly ? undefined : body);
  } catch {
    await sendStaticNotFound(response, headOnly, acceptsHtml);
  }
}

export function createAppServer({ database = null, authService = null, workspaceService = null, recommendationService = null, geoObservationService = null } = {}) {
  const auth = authService ?? (database ? createAuthService({ database, emailSender: createEmailSender() }) : null);
  const workspace = workspaceService ?? (database ? createWorkspaceService({ database }) : null);
  const recommendations = recommendationService ?? (database ? createRecommendationService({ database }) : null);
  const geoObservations = geoObservationService ?? (database ? createGeoObservationService({ database }) : null);
  const server = createServer(async (request, response) => {
    applySecurityHeaders(response);
    let url;
    try {
      url = new URL(request.url ?? "/", "http://searqon.local");
    } catch {
      sendJson(response, 400, { error: { code: "bad_request", message: "Invalid request URL." } });
      return;
    }


    if (url.pathname.startsWith("/api/v1/auth/")) {
      const authPath = url.pathname;
      const methods = {
        "/api/v1/auth/register": "POST",
        "/api/v1/auth/magic-link": "POST",
        "/api/v1/auth/verify": "POST",
        "/api/v1/auth/me": "GET",
        "/api/v1/auth/logout": "POST"
      };
      const method = methods[authPath];
      if (!method) {
        sendJson(response, 404, { error: { code: "not_found", message: "API route not found." } });
        return;
      }
      if (request.method !== method) {
        response.setHeader("allow", method);
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use " + method + "." } });
        return;
      }
      if (!auth) {
        sendJson(response, 503, { error: { code: "auth_unavailable", message: "Authentication is not configured for this environment." } });
        return;
      }
      if (method === "POST" && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      try {
        if (authPath === "/api/v1/auth/me") {
          const profile = await auth.getProfile(readSessionCookie(request));
          if (!profile) {
            sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to continue." } });
            return;
          }
          sendJson(response, 200, profile);
          return;
        }
        if (authPath === "/api/v1/auth/logout") {
          await auth.logout(readSessionCookie(request));
          clearSessionCookie(response);
          sendJson(response, 200, { status: "signed_out" });
          return;
        }
        if (!requireJsonContentType(request, response)) return;
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        if (authPath === "/api/v1/auth/register") {
          await auth.register(body, request.socket.remoteAddress);
          sendJson(response, 202, { message: "If the address can be registered, a sign-in link will be sent." });
          return;
        }
        if (authPath === "/api/v1/auth/magic-link") {
          await auth.requestMagicLink(body?.email, request.socket.remoteAddress);
          sendJson(response, 202, { message: "If the account exists, a sign-in link will be sent." });
          return;
        }
        if (authPath === "/api/v1/auth/verify") {
          const session = await auth.verify(body?.token);
          writeSessionCookie(response, session.sessionToken, session.expiresAt);
          sendJson(response, 200, { status: "authenticated", expiresAt: session.expiresAt });
          return;
        }
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        if (status === 429) response.setHeader("retry-after", "900");
        const message = status < 500 ? error.message : "The authentication request could not be completed.";
        const code = status < 500 ? (error.code ?? (status === 413 ? "payload_too_large" : "invalid_request")) : "auth_service_error";
        sendJson(response, status, { error: { code, message } });
        return;
      }
    }


    if (url.pathname === "/api/v1/projects") {
      if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET or POST." } });
        return;
      }
      if (!auth || !workspace) {
        sendJson(response, 503, { error: { code: "workspace_unavailable", message: "The authenticated workspace service is not configured." } });
        return;
      }
      if (request.method === "POST" && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to manage projects." } });
          return;
        }
        if (request.method === "GET") {
          const organizationId = url.searchParams.get("organizationId");
          sendJson(response, 200, { projects: await workspace.listProjects(profile.user.id, organizationId) });
          return;
        }
        if (!requireJsonContentType(request, response)) return;
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const project = await workspace.createProject(profile.user.id, body);
        sendJson(response, 201, { project });
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response, status, { error: { code: status < 500 ? (error.code ?? "invalid_request") : "workspace_error", message: status < 500 ? error.message : "The workspace request could not be completed." } });
      }
      return;
    }

    const projectGeoObservationsRoute = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/geo\/observations$/);
    if (projectGeoObservationsRoute) {
      const projectId = projectGeoObservationsRoute[1];
      if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("allow","GET, POST");
        sendJson(response,405,{error:{code:"method_not_allowed",message:"Use GET or POST."}});
        return;
      }
      if (!auth || !geoObservations) {
        sendJson(response,503,{error:{code:"geo_observations_unavailable",message:"The authenticated GEO observation service is not configured."}});
        return;
      }
      if (request.method === "POST" && !isSameOrigin(request,auth.publicOrigin)) {
        sendJson(response,403,{error:{code:"origin_rejected",message:"The request origin is not allowed."}});
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response,401,{error:{code:"unauthenticated",message:"Sign in to access GEO observations."}});
          return;
        }
        if (request.method === "GET") {
          const rawLimit = url.searchParams.get("limit");
          const limit = rawLimit === null ? 50 : Number(rawLimit);
          sendJson(response,200,{observations:await geoObservations.list(profile.user.id,projectId,{limit})});
          return;
        }
        if (!requireJsonContentType(request,response)) return;
        const body = await readJsonBody(request,MAX_BODY_BYTES);
        sendJson(response,201,await geoObservations.submit(profile.user.id,projectId,body));
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response,status,{error:{code:status < 500 ? (error.code ?? "invalid_request") : "geo_observation_error",message:status < 500 ? error.message : "The GEO observation request could not be completed."}});
      }
      return;
    }

    const geoEvidenceRoute = url.pathname.match(/^\/api\/v1\/geo-observations\/([^/]+)\/evidence$/);
    if (geoEvidenceRoute) {
      if (request.method !== "GET") {
        response.setHeader("allow","GET");
        sendJson(response,405,{error:{code:"method_not_allowed",message:"Use GET."}});
        return;
      }
      if (!auth || !geoObservations) {
        sendJson(response,503,{error:{code:"geo_observations_unavailable",message:"The authenticated GEO observation service is not configured."}});
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response,401,{error:{code:"unauthenticated",message:"Sign in to access GEO evidence."}});
          return;
        }
        sendJson(response,200,await geoObservations.getEvidence(profile.user.id,geoEvidenceRoute[1]));
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response,status,{error:{code:status < 500 ? (error.code ?? "invalid_request") : "geo_observation_error",message:status < 500 ? error.message : "The GEO evidence request could not be completed."}});
      }
      return;
    }

    const projectRecommendationsRoute = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/recommendations$/);
    if (projectRecommendationsRoute) {
      const projectId = projectRecommendationsRoute[1];
      if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("allow", "GET, POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET or POST." } });
        return;
      }
      if (!auth || !recommendations) {
        sendJson(response, 503, { error: { code: "recommendations_unavailable", message: "The authenticated recommendation service is not configured." } });
        return;
      }
      if (request.method === "POST" && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to manage recommendations." } });
          return;
        }
        if (request.method === "GET") {
          sendJson(response, 200, { recommendations: await recommendations.list(profile.user.id, projectId) });
          return;
        }
        if (!requireJsonContentType(request, response)) return;
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        const result = await recommendations.syncFromAssessment(profile.user.id, projectId, body?.assessmentId);
        sendJson(response, 200, result);
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response, status, { error: { code: status < 500 ? (error.code ?? "invalid_request") : "recommendations_error", message: status < 500 ? error.message : "The recommendation request could not be completed." } });
      }
      return;
    }

    const recommendationActionRoute = url.pathname.match(/^\/api\/v1\/recommendations\/([^/]+)(?:\/(status|verify|events))?$/);
    if (recommendationActionRoute) {
      const recommendationId = recommendationActionRoute[1];
      const action = recommendationActionRoute[2] ?? "events";
      const expectedMethod = action === "events" ? "GET" : "POST";
      if (request.method !== expectedMethod) {
        response.setHeader("allow", expectedMethod);
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use " + expectedMethod + "." } });
        return;
      }
      if (!auth || !recommendations) {
        sendJson(response, 503, { error: { code: "recommendations_unavailable", message: "The authenticated recommendation service is not configured." } });
        return;
      }
      if (expectedMethod === "POST" && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to manage recommendations." } });
          return;
        }
        if (action === "events") {
          sendJson(response, 200, { events: await recommendations.history(profile.user.id, recommendationId) });
          return;
        }
        if (!requireJsonContentType(request, response)) return;
        const body = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
        if (action === "status") {
          sendJson(response, 200, { recommendation: await recommendations.transition(profile.user.id, recommendationId, body?.status) });
        } else {
          sendJson(response, 200, { recommendation: await recommendations.verify(profile.user.id, recommendationId, body?.assessmentId) });
        }
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response, status, { error: { code: status < 500 ? (error.code ?? "invalid_request") : "recommendations_error", message: status < 500 ? error.message : "The recommendation request could not be completed." } });
      }
      return;
    }

    const projectRoute = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(assessments))?$/);
    if (projectRoute) {
      const projectId = projectRoute[1];
      const isAssessmentsRoute = Boolean(projectRoute[2]);
      if ((!isAssessmentsRoute && request.method !== "GET") || (isAssessmentsRoute && request.method !== "GET" && request.method !== "POST")) {
        response.setHeader("allow", isAssessmentsRoute ? "GET, POST" : "GET");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: isAssessmentsRoute ? "Use GET or POST." : "Use GET." } });
        return;
      }
      if (!auth || !workspace) {
        sendJson(response, 503, { error: { code: "workspace_unavailable", message: "The authenticated workspace service is not configured." } });
        return;
      }
      if (request.method === "POST" && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      try {
        const profile = await auth.getProfile(readSessionCookie(request));
        if (!profile?.user?.id) {
          sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to access this project." } });
          return;
        }
        if (!isAssessmentsRoute) {
          const project = await workspace.getProject(profile.user.id, projectId);
          if (!project) {
            sendJson(response, 404, { error: { code: "project_not_found", message: "The requested project was not found." } });
            return;
          }
          sendJson(response, 200, { project });
          return;
        }
        if (request.method === "GET") {
          sendJson(response, 200, { assessments: await workspace.listAssessments(profile.user.id, projectId) });
          return;
        }
        if (!requireJsonContentType(request, response)) return;
        const body = await readJsonBody(request);
        const assessment = await workspace.createAssessment(profile.user.id, projectId, body);
        sendJson(response, 201, { assessment });
      } catch (error) {
        const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        sendJson(response, status, { error: { code: status < 500 ? (error.code ?? "invalid_request") : "workspace_error", message: status < 500 ? error.message : "The workspace request could not be completed." } });
      }
      return;
    }

    if (url.pathname === "/api/v1/ready") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET." } });
        return;
      }
      if (!database) {
        sendJson(response, 503, { status: "not_ready", reason: "database_not_configured" });
        return;
      }
      try {
        const ready = await database.healthCheck();
        sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" });
      } catch {
        sendJson(response, 503, { status: "not_ready", reason: "database_unavailable" });
      }
      return;
    }

    if (url.pathname === "/api/v1/health") {
      if (request.method !== "GET") {
        response.setHeader("allow", "GET");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET." } });
        return;
      }
      sendJson(response, 200, { status: "ok", service: "searqon-web", apiVersion: "v1" });
      return;
    }

    if (url.pathname === "/api/v1/assessments") {
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use POST." } });
        return;
      }
      if (auth && !isSameOrigin(request, auth.publicOrigin)) {
        sendJson(response, 403, { error: { code: "origin_rejected", message: "The request origin is not allowed." } });
        return;
      }
      if (process.env.NODE_ENV === "production") {
        if (!auth) {
          sendJson(response, 503, { error: { code: "assessment_unavailable", message: "Authenticated assessment service is not configured." } });
          return;
        }
        try {
          const profile = await auth.getProfile(readSessionCookie(request));
          if (!profile) {
            sendJson(response, 401, { error: { code: "unauthenticated", message: "Sign in to run an assessment." } });
            return;
          }
        } catch {
          sendJson(response, 503, { error: { code: "assessment_unavailable", message: "Assessment authentication is temporarily unavailable." } });
          return;
        }
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
        sendJson(response, 415, { error: { code: "unsupported_media_type", message: "Send an application/json request body." } });
        return;
      }
      try {
        const input = validateAssessmentInput(await readJsonBody(request));
        const assessment = analyzeDocument(input);
        sendJson(response, 201, assessment);
      } catch (error) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 422;
        const code = error.code ?? (status === 413 ? "payload_too_large" : status === 415 ? "unsupported_media_type" : status === 400 ? "invalid_request" : "assessment_rejected");
        sendJson(response, status, { error: { code, message: error.message } });
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: { code: "not_found", message: "API route not found." } });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET or HEAD." } });
      return;
    }
    await serveStatic(url.pathname, response, request.method === "HEAD", request.headers.accept?.includes("text/html") ?? false);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  server.maxHeadersCount = 100;
  return server;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? "4173", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("PORT must be an integer between 1 and 65535.\n");
    process.exitCode = 1;
  } else {
    const database = process.env.DATABASE_URL ? createDatabase() : null;
    let authService = null;
    try {
      authService = database ? createAuthService({ database, emailSender: createEmailSender() }) : null;
    } catch (error) {
      database?.close().catch(() => {});
      process.stderr.write("Searqon authentication configuration error: " + error.message + "\n");
      process.exitCode = 1;
    }
    if (process.exitCode !== 1) {
      const server = createAppServer({ database, authService });
      server.listen(port, host, () => {
        process.stdout.write("Searqon web listening on http://" + host + ":" + port + "\n");
      });
      let shuttingDown = false;
      const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        server.close(() => {
          if (!database) {
            process.exit(0);
            return;
          }
          database.close().then(() => process.exit(0)).catch(() => process.exit(1));
        });
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    }
  }
}
