# ADR-0002: Single-repository Searqon product architecture

- **Status:** Accepted
- **Date:** 2026-11-16
- **Decision owners:** Searqon product owner and engineering
- **Supersedes:** Any implication that hosted Searqon requires a separate repository

## Context

Searqon began as an Apache-2.0 local intelligence toolkit. The product direction now includes a public marketing site, authenticated workspace, API, asynchronous assessment workers, persistent evidence, integrations, metering and enterprise operations. Splitting the commercial control plane into another repository would fragment domain contracts, increase release coordination and violate the explicit product ownership decision.

## Decision

All Searqon source code, tests, schemas, migrations, deployment definitions and documentation remain in **this repository**: `LloydCoder/tinlance-searqon`.

The repository will evolve as a modular monolith/monorepo. Deployable applications may be independently built and deployed, but they share one source repository, one versioned domain contract system and one CI/security governance baseline.

Target boundaries, introduced when implemented consumers exist:

- `apps/web`: public website and authenticated customer workspace.
- `apps/api`: HTTP API, authentication boundary, tenant-scoped use cases.
- `apps/worker`: queued/scheduled assessment execution.
- `apps/cli`: local toolkit.
- `packages/domain`, `assessment`, `evidence`, `acquisition`, `recommendations`, `auth`, `persistence`, `integrations`, `billing`, `ui`: shared internal packages.
- `db/migrations`: append-only database migrations.
- `infra`: deployment and operational configuration.

Do not create empty placeholder packages. Establish a boundary when the first real implementation and consumer require it. Existing public modules remain usable without hosted credentials or paid APIs.

## Consequences

### Positive
- One authoritative source for product behavior, schemas, tests and security controls.
- Cross-module changes can be reviewed and released atomically.
- The CLI and local toolkit can reuse the same deterministic assessment engines as hosted workloads.
- One CI/CD and supply-chain policy can cover all deployable artifacts.

### Trade-offs
- CI must become path-aware or matrix-based as the repository grows.
- Deployment permissions and secrets must be scoped per workload/environment even though source is shared.
- Public Apache-2.0 code and any future proprietary distribution boundary require an explicit licensing/release policy; secrets, customer data and production configuration are never committed.
- Internal package boundaries must be enforced through dependency rules and tests to avoid a monolith becoming tightly coupled.

## Security constraints

- No shared database owner credentials in application workloads.
- Runtime database roles must be non-superuser and must not have `BYPASSRLS`.
- Tenant authorization must be enforced in authenticated application use cases and PostgreSQL row-level security.
- Database identity context must be set transaction-locally and cleared automatically by transaction completion; never persist tenant/user context on a pooled connection.
- Migrations run under a separate deployment identity and are not executed by the request-serving role.
- Background jobs re-resolve organization membership/authorization at execution time; enqueue-time authorization is not sufficient.
- No worker or agent obtains mutation authority from model output or discovered interfaces.
- No production deploy or external integration is enabled by the existence of source code alone.

## Rejected alternatives

1. **Separate private Searqon Cloud repository:** rejected because the product owner explicitly requires one repository and it fragments the source of truth.
2. **Premature microservices:** rejected until measured scaling, isolation or reliability needs justify separate services.
3. **One unstructured application directory:** rejected because domain, persistence, identity and execution boundaries must remain testable and enforceable.

## Acceptance

This ADR is accepted as the governing repository boundary. It does not assert that the hosted service, identity, billing, integrations or production deployment are implemented.
