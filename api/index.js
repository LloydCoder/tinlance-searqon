import { createAppServer } from "../apps/web/server.js";
import { createDatabase } from "../src/platform/database.js";
import { createAuthService } from "../src/platform/auth.js";
import { createEmailSender } from "../src/platform/email.js";
import { createWorkspaceService } from "../src/platform/workspaces.js";

let applicationServer;

export function createVercelHandler(server) {
  if (!server || typeof server.emit !== "function") {
    throw new TypeError("A Node HTTP server with an emit method is required.");
  }
  return function vercelHandler(request, response) {
    return server.emit("request", request, response);
  };
}

function createProductionServer() {
  const database = process.env.DATABASE_URL
    ? createDatabase({ maxConnections: 2 })
    : null;

  const emailSender = createEmailSender();
  const authConfigured = Boolean(
    database &&
    process.env.PUBLIC_APP_ORIGIN &&
    process.env.AUTH_RATE_LIMIT_SECRET &&
    Buffer.byteLength(process.env.AUTH_RATE_LIMIT_SECRET, "utf8") >= 32 &&
    emailSender.available
  );

  const authService = authConfigured
    ? createAuthService({
        database,
        emailSender,
        publicOrigin: process.env.PUBLIC_APP_ORIGIN,
        rateLimitSecret: process.env.AUTH_RATE_LIMIT_SECRET
      })
    : false;
  const workspaceService = database ? createWorkspaceService({ database }) : false;

  return createAppServer({ database, authService, workspaceService });
}

export default function handler(request, response) {
  if (!applicationServer) applicationServer = createProductionServer();
  return createVercelHandler(applicationServer)(request, response);
}
