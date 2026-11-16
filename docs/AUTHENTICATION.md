# Searqon authentication and session security

**Status:** Passwordless email authentication is implemented in the local application stack and covered by PostgreSQL 16 integration tests. Production email delivery and deployment configuration are not yet provisioned.

## User flows

- `POST /api/v1/auth/register`: creates a user, organization, owner membership and one-time magic-link token.
- `POST /api/v1/auth/magic-link`: requests a sign-in link for an existing account. The response is identical whether the account exists or not.
- `POST /api/v1/auth/verify`: consumes a one-time token and creates a server-side session.
- `GET /api/v1/auth/me`: resolves the session and returns the authenticated profile and organization memberships.
- `POST /api/v1/auth/logout`: revokes the current session and clears the cookie.

The browser UI is available at `/auth/register/`, `/auth/login/`, `/auth/verify/` and `/app/`.

## Token and session handling

- Magic-link tokens are 32 random bytes encoded as base64url, valid for 15 minutes and stored only as SHA-256 digests.
- Issuing a replacement link invalidates prior unconsumed links for the account.
- The email link carries the token in the URL fragment, not a query string. Fragments are not sent in HTTP requests or Referer headers.
- Opening the link does not consume it. The user must activate the confirmation button; the page removes the fragment from browser history before submitting the token.
- The database consumes the token and creates the session atomically. A token can only be consumed once. Workspace creation, magic-link issuance, session creation and session revocation are recorded in the append-only workspace audit ledger; raw tokens, email addresses and IP values are not copied into event metadata.
- Session secrets are 32 random bytes; only their SHA-256 digests are stored. Sessions expire after 30 minutes of inactivity and 24 hours absolute.
- Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure in production. Production uses the `__Host-searqon_session` prefix; local HTTP development uses `searqon_session`.
- Logout revokes the server-side session. Invalid or expired cookies do not authenticate a request.

## CSRF and browser boundaries

Every state-changing auth endpoint requires an exact Origin match against `PUBLIC_APP_ORIGIN`. No permissive CORS policy is enabled. Cookie-authenticated state changes therefore require both same-site cookie behavior and origin validation. Auth JSON bodies are limited to 16 KiB. Auth responses use `Cache-Control: no-store`.

The magic-link token is never written to localStorage or sessionStorage. No token is consumed on GET, protecting against email security scanners that prefetch links.

## Distributed rate limits

The API HMACs normalized email addresses and the socket peer IP with `AUTH_RATE_LIMIT_SECRET`; only 32-byte HMAC digests are stored. PostgreSQL applies atomic limits of 5 attempts per email and 10 per peer IP in a 15-minute window. The API does not trust `X-Forwarded-For`; deployments behind proxies must configure a trusted edge and a deliberate client-IP strategy before changing this boundary.

The HMAC secret must be at least 32 bytes and identical across all application instances. Do not rotate it without planning the effect on active rate-limit buckets.

## Email delivery

Production delivery uses the Resend HTTP API through the native Node.js fetch implementation. Required environment variables:

- `RESEND_API_KEY`: secret API key.
- `SEARQON_EMAIL_FROM`: verified sender identity.
- `PUBLIC_APP_ORIGIN`: exact HTTPS origin of the application.
- `AUTH_RATE_LIMIT_SECRET`: at least 32 bytes of high-entropy secret material.
- `DATABASE_URL`: runtime PostgreSQL login that is a member of `searqon_app`.
- `DATABASE_SSL_CA`: optional PEM CA bundle for remote providers with a private trust root; URL-level SSL flags cannot disable certificate verification.
- `MIGRATION_DATABASE_URL`: separate migration identity URL; the migration runner falls back to `DATABASE_URL` only when this variable is absent.

Resend requests include an idempotency key derived from the database token ID. Provider response bodies, API keys and magic-link tokens are not logged. Email delivery is disabled by default. In local development only, set `SEARQON_EMAIL_MODE=console` to print a one-time link to the developer console; never enable this mode in production.

If delivery is not configured, registration and magic-link requests fail before creating a user or token. If delivery fails after a database write, the user can request another link; issuing the replacement invalidates the prior token.

## Database privilege model

- `searqon_app` is a non-login, non-superuser, NOBYPASSRLS role with only the application grants.
- The runtime login role must be non-superuser, non-owner and NOBYPASSRLS, and must be granted membership in `searqon_app`. Every tenant transaction explicitly uses `SET LOCAL ROLE searqon_app`.
- Authentication functions are narrowly scoped SECURITY DEFINER functions owned by the dedicated migration/table owner. The runtime role receives EXECUTE on those functions, not direct SELECT/INSERT/UPDATE access to auth tokens or rate-limit rows.
- Auth functions are the only application path that provisions accounts, organizations, memberships, magic-link tokens and sessions.
- Tenant-scoped application queries run through the RLS-restricted role and set the authenticated user ID transaction-locally.

The migration owner is a privileged trust anchor and must not be used by the request-serving application. Do not run the API with a superuser, table-owner or BYPASSRLS connection.

## Operational setup

1. Provision PostgreSQL 16+.
2. Run migrations with a dedicated migration identity that owns the schema/tables and has the required CREATEROLE permission: `npm run db:migrate`.
3. Create a runtime login role with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS`, then grant it membership in `searqon_app`.
4. Configure the runtime `DATABASE_URL`, `PUBLIC_APP_ORIGIN`, `AUTH_RATE_LIMIT_SECRET`, `RESEND_API_KEY` and `SEARQON_EMAIL_FROM` as environment secrets.
5. Enforce HTTPS at the ingress/load balancer and restrict database network access to application and migration workloads.
6. Test magic-link delivery, token expiry/replay, session revocation, rate limits, backup/restore and incident procedures before public production launch.

## Not yet implemented

- OAuth/OIDC, passkeys, MFA, recovery codes, administrator account recovery or enterprise SSO.
- Device/session management UI, session rotation and forced sign-out across all devices.
- Trusted reverse-proxy IP configuration and edge-level abuse controls.
- Email bounce/complaint webhooks, deliverability monitoring and retry queue.
- Data retention/cleanup for expired tokens and rate-limit rows.
- Production secrets, runtime roles, domain verification, deployment, monitoring, backups and recovery drills.


## Session lifetime

Sessions expire after 30 minutes of inactivity and 24 hours absolute. The database-backed session lookup updates `last_seen_at` only for a valid, unrevoked, unexpired session. A session that has been idle for more than 30 minutes is rejected and requires a new one-time sign-in link. This is an initial risk-based setting and must be reviewed before production launch against the Searqon threat model and ASVS 5.0 session-management requirements.
