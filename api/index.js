import { createAppServer } from "../apps/web/server.js";
import { createDatabase } from "../src/platform/database.js";
import { createAuthService } from "../src/platform/auth.js";
import { createEmailSender } from "../src/platform/email.js";
import { createWorkspaceService } from "../src/platform/workspaces.js";
import { getAuthConfigurationStatus } from "../src/platform/auth-config.js";

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
  const authConfiguration = getAuthConfigurationStatus({
    databaseConfigured: Boolean(database),
    publicOrigin: process.env.PUBLIC_APP_ORIGIN,
    rateLimitSecret: process.env.AUTH_RATE_LIMIT_SECRET,
    emailSenderAvailable: emailSender.available
  });
  process.stdout.write(JSON.stringify({
    event: "searqon_auth_configuration",
    configured: authConfiguration.configured,
    missing: authConfiguration.missing
  }) + "\\n");

  const authService = authConfiguration.configured
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
