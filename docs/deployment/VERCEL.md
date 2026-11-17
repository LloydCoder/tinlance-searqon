# Vercel deployment

**Status:** Deployment adapter implemented; production activation requires the external database and transactional-email configuration listed below.

Searqon uses one repository. The Vercel project must be linked to `LloydCoder/tinlance-searqon` with the repository root as its Root Directory and `main` as its Production Branch. Do not create a second cloud repository or move the application into a separate source repository.

## Runtime shape

- `api/index.js` adapts the existing Node HTTP application to a Vercel Node.js Function.
- `vercel.json` routes incoming paths through the application handler and preserves the original request path.
- `apps/web/public/**` is explicitly included in the function bundle because the existing server reads those files from disk.
- The function reuses a warm-instance PostgreSQL pool capped at two connections.
- No migration is run automatically during a request or deployment.
- The existing local `npm run dev:web` workflow remains unchanged.

## Required production environment

Configure these values in Vercel Project Settings → Environment Variables. Never commit them or paste secret values into chat, issues, or pull requests.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes for workspace/auth | PostgreSQL application connection URL. Use a provider-supported pooler suitable for serverless workloads. |
| `PUBLIC_APP_ORIGIN` | Yes for auth | Exact HTTPS origin, for example `https://searqon.tinlance.com`. |
| `AUTH_RATE_LIMIT_SECRET` | Yes for auth | Random secret with at least 32 UTF-8 bytes. |
| `RESEND_API_KEY` | Yes for email sign-in | Resend transactional email API key. |
| `SEARQON_EMAIL_FROM` | Yes for email sign-in | Verified sender identity on a domain authorized in Resend. |
| `DATABASE_SSL_CA` | Optional | PEM CA certificate when the PostgreSQL provider requires a custom CA. |

The serverless adapter fails closed: if the database, public origin, rate-limit secret, or email delivery is not configured, account and workspace operations remain unavailable rather than falling back to insecure local settings. Public pages and liveness checks can still be served.

Use separate least-privilege credentials for runtime and migrations where the database provider supports them. Do not use a database superuser as the application role. The application connection must be compatible with the repository's `searqon_app` role and tenant RLS model.

## Database migration and readiness

1. Confirm the intended Searqon PostgreSQL project and its region, ownership, backup policy and pricing.
2. Provision the database only after the project owner approves the provider and cost. Do not reuse an unrelated Tinlance database.
3. Configure a protected migration connection as `MIGRATION_DATABASE_URL` in a controlled one-time migration environment.
4. Run `npm run db:migrate` against the intended database and verify the migration checksums and schema.
5. Configure the runtime `DATABASE_URL` using a restricted application role and a serverless-compatible connection pool.
6. Configure Resend and the exact public origin, then test registration, magic-link delivery, verification, logout, tenant isolation and audit persistence.
7. Verify `/api/v1/ready` returns ready before enabling account creation.

Do not execute migrations automatically on every serverless cold start.

## Deployment and domain

- Production branch: `main`.
- Root Directory: repository root.
- Framework preset: Other / Node.js functions.
- Keep deployment protection and GitHub CI checks enabled.
- Attach `searqon.tinlance.com` to the Searqon Vercel project, then use the exact DNS target and verification challenge returned by Vercel.
- In Cloudflare, initially use a DNS-only CNAME until Vercel confirms domain verification and TLS issuance. Enable Cloudflare proxying only after end-to-end behavior has been tested.
- Never replace unrelated DNS records or change zone nameservers as part of this deployment.

## Acceptance checks

- [ ] Vercel deployment is READY for the intended main commit.
- [ ] Homepage, every public page, sitemap, robots.txt, llms.txt, icons and static assets return expected content and MIME types.
- [ ] `/api/v1/health` returns 200.
- [ ] `/api/v1/ready` confirms PostgreSQL readiness.
- [ ] Registration, magic-link delivery, verification, authenticated project CRUD, assessment persistence and logout pass production smoke tests.
- [ ] Tenant isolation and audit controls pass against the deployed database.
- [ ] HTTPS certificate is valid; canonical hostname and redirects are correct.
- [ ] Mobile browser QA and accessibility checks are completed on the deployed URL.
- [ ] Runtime errors, logs, backups, rollback and incident ownership are reviewed.

A successful Vercel build is not evidence that the database, email delivery, authentication, tenant isolation or the product roadmap is production-ready.
