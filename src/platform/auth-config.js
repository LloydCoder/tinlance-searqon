export function getAuthConfigurationStatus({
  databaseConfigured,
  publicOrigin,
  rateLimitSecret,
  emailSenderAvailable
} = {}) {
  const missing = [];
  if (databaseConfigured !== true) missing.push("DATABASE_URL");
  if (typeof publicOrigin !== "string" || publicOrigin.length === 0) missing.push("PUBLIC_APP_ORIGIN");
  if (typeof rateLimitSecret !== "string" || Buffer.byteLength(rateLimitSecret, "utf8") < 32) {
    missing.push("AUTH_RATE_LIMIT_SECRET");
  }
  if (emailSenderAvailable !== true) missing.push("RESEND_API_KEY_OR_SEARQON_EMAIL_FROM");
  return Object.freeze({ configured: missing.length === 0, missing: Object.freeze(missing) });
}
