# Agent Journey Sandbox — Phase 11 implementation increment

**Status:** IN PROGRESS — bounded read-only simulation foundation implemented; Phase 11 is not accepted.

## Design decision: reuse the existing Searqon runtime

This implementation reuses the existing single repository, Node.js runtime, PostgreSQL database, durable job queue, lease/retry protocol, worker runner, authenticated tenant transaction and CI infrastructure. It does not introduce a new cloud account, AWS service, Kubernetes cluster, external sandbox vendor, model provider or paid dependency.

The new workload is a separate process in the existing worker deployment model. Its input and output contracts are registered as experimental version 1.0.0 schemas (`schemas/agent-simulation-manifest.schema.json` and `schemas/agent-simulation-result.schema.json`); these are standalone contracts, not new evidence observation classes. The implementation consists of:

- `src/agent-sandbox.js` — deterministic, read-only simulation over caller-supplied snapshots.
- `src/platform/agent-sandbox-service.js` — authenticated-tenant enqueue/result service.
- `src/platform/agent-sandbox-executor.js` and `agent-sandbox-child.js` — one disposable Node child per run, with Node's permission model, source-only read access, no filesystem writes, no child-process/worker-thread permission, a 64 MiB heap cap and a 5-second wall-clock timeout. The child receives only the bounded manifest and has no database credentials.\n- `src/platform/agent-sandbox-worker.js` — durable queue handler and result persistence.
- `src/platform/agent-sandbox-worker-process.js` — dedicated process entry point and database-role preflight.
- `db/migrations/0013_agent_simulation_sandbox.sql` — job type, isolated database role and result table.
- `test/agent-sandbox*.test.js` and the agent-worker case in `test/jobs.integration.test.js` — unit and PostgreSQL isolation coverage.

## What the current simulator does

The simulator consumes a versioned manifest containing a declared HTTPS origin, a small set of already-acquired document snapshots, and an explicit journey manifest. It supports:

- Discover the supplied snapshot inventory.
- Read document metadata and derive a digest of normalized text.
- Follow a link only when its destination exists in the supplied same-origin snapshot set.
- Inspect supplied OpenAPI JSON metadata.
- Inspect supplied MCP tool metadata without invoking tools.

It does not perform network requests, execute page scripts, execute user-provided code, invoke MCP tools, call an LLM, submit forms, authenticate, write to repositories, or mutate remote systems. Page and metadata content are untrusted data, never instructions.

## Resource limits

| Limit | Current value |
|---|---:|
| Supplied documents | 12 |
| Bytes per document | 8 KiB |
| Aggregate document bytes | 12 KiB |
| Canonical manifest bytes | 15 KiB |
| Journey steps | 30 |
| Persisted result JSON | 64 KiB database limit |
| Simulator result bytes | 48 KiB |
| Worker concurrency | 1 by default; maximum 2 |
| Queue attempts | 2 for simulation jobs |

The job queue independently enforces its existing 16 KiB payload cap and rejects sensitive-key names in payload objects. Only public or explicitly authorized snapshots should be submitted. Queue payloads are retained in PostgreSQL according to the existing jobs lifecycle; a dedicated simulation-input retention/purge policy is still required.

## Worker and database isolation

The new `searqon_agent_worker` role is distinct from `searqon_worker`. It can:

- Select and update only `agent_simulation` queue rows through RLS.
- Append worker events for simulation jobs.
- Read/insert simulation result rows while holding the matching active job lease.

It cannot read alert destinations or alert-delivery outbox records, create databases/schemas, or update/delete simulation results. The existing application role can read results only through organization membership RLS. The result record is bound to the job and organization and stores input/result SHA-256 digests.

The existing worker login must be able to assume `searqon_agent_worker`. Migration 0013 grants that membership to the existing `searqon_worker` role; confirm the actual runtime login inherits or can assume `searqon_worker` before starting the process.

## Existing infrastructure deployment

Apply migrations through the existing migration runner, then start the new worker in the same approved worker runtime:

```sh
npm run db:migrate
SEARQON_AGENT_WORKER_DATABASE_URL="$SEARQON_WORKER_DATABASE_URL" \
SEARQON_AGENT_WORKER_ID="agent-sandbox-01" \
npm run start:agent-sandbox-worker
```

The database URL must use a restricted worker login that can assume the agent worker role. Do not reuse the web application's privileged migration credentials. The worker is not started automatically by this change and no production deployment or secret change is authorized by this implementation.

## Threat model and remaining acceptance work

The sandbox threat model is deliberately narrow: trusted, first-party deterministic simulator code processes bounded, untrusted JSON snapshots. It is not a hostile-code runtime. It does not execute page scripts, user-provided code, plugins, MCP tools, or arbitrary model-generated actions; it has no acquisition or network adapter. The per-run child is disposable, receives only the bounded manifest, has no database credentials, and is restricted by Node's permission model, source-only file reads, disabled network globals, a static dependency guard, a 64 MiB heap cap, a 5-second wall-clock kill, and bounded input/output. Queue lease cancellation now kills the child immediately. **Important runtime boundary:** the Node 22/24 Permission Model used by CI restricts filesystem, child-process and worker-thread capabilities, but does not itself deny network access; the current no-acquisition guarantee comes from the deliberately network-free trusted code path, static import guard and disabled globals—not from an OS-level egress control. See the [Node 22 permission documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/permissions.html) and [Node 24 permission documentation](https://nodejs.org/docs/latest-v24.x/api/permissions.html). Node's own documentation also states that its permission model is not a security boundary for malicious code.

OS/container-level egress denial and cgroup CPU quotas are not represented as controls supplied by this snapshot-only implementation. They are hard prerequisites before adding active network acquisition, arbitrary executable code, or untrusted extensions. Do not describe the current child process as a hardened hostile-code container.

Remaining Phase 11 acceptance work:

1. Exercise unexpected child-process termination and retry against the actual worker/database runtime in authorized staging; current CI covers child cancellation, bounded child errors, lease fencing, and the worker-runner retry path with a simulated child failure.
2. Confirm worker deployment resource limits and observability in an authorized staging runtime; do not start the worker or change production secrets as part of this code-only PR.
3. Add customer-visible simulation history and evidence export only after Phase 1 validates the user workflow.
4. Obtain staging authorization and explicit product-owner acceptance.

No mutation capability should be added by default. Any future write action requires a separate operation-level authorization contract, synthetic staging data and human approval. No model, page, MCP description, tool metadata or job payload can grant that authority.
