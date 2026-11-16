import { createHash, createHmac, randomBytes } from "node:crypto";
import { withUserTransaction } from "./database.js";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new AuthError(400, "invalid_email", "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new AuthError(400, "invalid_email", "Enter a valid email address.");
  }
  return email;
}

function boundedText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxLength) {
    throw new AuthError(400, "invalid_request", field + " must be between 1 and " + maxLength + " characters.");
  }
  return value.trim();
}

function createOrganizationSlug(name) {
  const base = name.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52) || "workspace";
  return base + "-" + randomBytes(3).toString("hex");
}

function tokenDigest(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function validatePublicOrigin(value, nodeEnv) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_APP_ORIGIN must be a valid origin.");
  }
  if (parsed.origin !== value.replace(/\/$/, "") || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_APP_ORIGIN must contain only an origin, without credentials, path, query or fragment.");
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_ORIGIN must use HTTPS in production.");
  }
  if (parsed.protocol !== "https:" && !(nodeEnv !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
    throw new Error("PUBLIC_APP_ORIGIN must use HTTPS except on loopback development hosts.");
  }
  return parsed.origin;
}

export function createAuthService({
  database,
  emailSender,
  nodeEnv = process.env.NODE_ENV ?? "development",
  publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? "http://127.0.0.1:4173",
  rateLimitSecret = process.env.AUTH_RATE_LIMIT_SECRET ?? (nodeEnv === "production" ? "" : "searqon-local-development-rate-limit-secret")
} = {}) {
  if (!database?.pool || typeof database.pool.query !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  if (!emailSender || typeof emailSender.sendMagicLink !== "function") {
    throw new TypeError("A transactional email sender is required.");
  }
  if (typeof rateLimitSecret !== "string" || Buffer.byteLength(rateLimitSecret) < 32) {
    throw new Error("AUTH_RATE_LIMIT_SECRET must contain at least 32 bytes.");
  }

  const origin = validatePublicOrigin(publicOrigin, nodeEnv);
  const secret = Buffer.from(rateLimitSecret, "utf8");

  function rateLimitHash(value) {
    return createHmac("sha256", secret).update(value, "utf8").digest();
  }

  async function enforceRateLimits(email, ipAddress) {
    const ip = typeof ipAddress === "string" && ipAddress.length <= 128 ? ipAddress : "unknown";
    const limits = [
      { hash: rateLimitHash("ip:" + ip), maximum: 10 },
      { hash: rateLimitHash("email:" + email), maximum: 5 }
    ];
    for (const item of limits) {
      const result = await database.pool.query(
        "SELECT searqon.consume_auth_rate_limit($1, $2, $3) AS allowed",
        [item.hash, item.maximum, 900]
      );
      if (result.rows?.[0]?.allowed !== true) {
        throw new AuthError(429, "rate_limited", "Too many sign-in attempts. Try again later.");
      }
    }
  }

  async function deliverMagicLink(email, token, tokenId) {
    if (emailSender.available === false) {
      throw new AuthError(503, "email_not_configured", "Sign-in email delivery is not configured for this environment.");
    }
    const url = new URL("/auth/verify/", origin);
    url.hash = "token=" + token;
    try {
      await emailSender.sendMagicLink({
        to: email,
        url: url.toString(),
        idempotencyKey: "searqon-magic-link/" + tokenId
      });
    } catch {
      throw new AuthError(503, "email_delivery_unavailable", "Sign-in email delivery is temporarily unavailable. Try again shortly.");
    }
  }

  async function issueMagicLink(email) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    const result = await database.pool.query(
      "SELECT * FROM searqon.issue_magic_link($1, $2, $3)",
      [email, tokenDigest(token), expiresAt]
    );
    const row = result.rows?.[0];
    if (!row) return false;
    await deliverMagicLink(email, token, row.token_id);
    return true;
  }

  return {
    publicOrigin: origin,

    async register(input, ipAddress) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new AuthError(400, "invalid_request", "Registration details are required.");
      }
      const email = normalizeEmail(input.email);
      const displayName = boundedText(input.displayName, "Display name", 120);
      const organizationName = boundedText(input.organizationName, "Organization name", 160);
      await enforceRateLimits(email, ipAddress);

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
      let row;
      try {
        const result = await database.pool.query(
          "SELECT * FROM searqon.register_account($1, $2, $3, $4, $5, $6)",
          [email, displayName, organizationName, createOrganizationSlug(organizationName), tokenDigest(token), expiresAt]
        );
        row = result.rows?.[0];
      } catch (error) {
        if (error?.code !== "23505" || error?.constraint !== "app_users_email_unique") throw error;
        await issueMagicLink(email);
        return { accepted: true };
      }

      if (!row) throw new AuthError(503, "registration_unavailable", "Registration is temporarily unavailable.");
      await deliverMagicLink(email, token, row.token_id);
      return { accepted: true };
    },

    async requestMagicLink(rawEmail, ipAddress) {
      const email = normalizeEmail(rawEmail);
      await enforceRateLimits(email, ipAddress);
      await issueMagicLink(email);
      // Identical response whether the address is registered or not.
      return { accepted: true };
    },

    async verify(rawToken) {
      if (typeof rawToken !== "string" || !TOKEN_PATTERN.test(rawToken)) {
        throw new AuthError(400, "invalid_or_expired_link", "This sign-in link is invalid or has expired. Request a new one.");
      }
      const sessionToken = randomBytes(32).toString("base64url");
      const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const result = await database.pool.query(
        "SELECT * FROM searqon.consume_magic_link_and_create_session($1, $2, $3)",
        [tokenDigest(rawToken), tokenDigest(sessionToken), sessionExpiresAt]
      );
      const row = result.rows?.[0];
      if (!row) {
        throw new AuthError(400, "invalid_or_expired_link", "This sign-in link is invalid or has expired. Request a new one.");
      }
      return {
        userId: row.user_id,
        sessionToken,
        expiresAt: row.session_expires_at instanceof Date ? row.session_expires_at : new Date(row.session_expires_at)
      };
    },

    async getProfile(sessionToken) {
      if (typeof sessionToken !== "string" || !TOKEN_PATTERN.test(sessionToken)) return null;
      const session = await database.pool.query(
        "SELECT * FROM searqon.lookup_session($1)",
        [tokenDigest(sessionToken)]
      );
      const userId = session.rows?.[0]?.user_id;
      if (!userId) return null;

      return withUserTransaction(database.pool, userId, async client => {
        const userResult = await client.query(
          "SELECT id, email, display_name, email_verified_at FROM searqon.app_users WHERE id = $1",
          [userId]
        );
        if (!userResult.rows?.[0]) return null;
        const organizations = await client.query(
          `SELECT o.id, o.name, o.slug, m.role
           FROM searqon.memberships AS m
           JOIN searqon.organizations AS o ON o.id = m.organization_id
           WHERE m.user_id = $1
           ORDER BY o.name, o.id`,
          [userId]
        );
        return { user: userResult.rows[0], organizations: organizations.rows ?? [] };
      });
    },

    async logout(sessionToken) {
      if (typeof sessionToken !== "string" || !TOKEN_PATTERN.test(sessionToken)) return { revoked: false };
      const result = await database.pool.query(
        "SELECT searqon.revoke_session($1) AS revoked",
        [tokenDigest(sessionToken)]
      );
      return { revoked: result.rows?.[0]?.revoked === true };
    }
  };
}
