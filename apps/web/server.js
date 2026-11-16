import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeDocument } from "../../src/analyzer.js";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const MAX_BODY_BYTES = 2 * 1024 * 1024 + 8192;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/markdown", "application/json"]);
const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
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
  response.setHeader("content-security-policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; upgrade-insecure-requests");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
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

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: { code: "bad_path", message: "Invalid URL path." } });
    return;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const extension = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) {
      sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=300"
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: { code: "not_found", message: "Resource not found." } });
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    applySecurityHeaders(response);
    let url;
    try {
      url = new URL(request.url ?? "/", "http://searqon.local");
    } catch {
      sendJson(response, 400, { error: { code: "bad_request", message: "Invalid request URL." } });
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
    await serveStatic(url.pathname, response);
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? "4173", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("PORT must be an integer between 1 and 65535.\n");
    process.exitCode = 1;
  } else {
    const server = createAppServer();
    server.listen(port, host, () => {
      process.stdout.write("Searqon web listening on http://" + host + ":" + port + "\n");
    });
  }
}
