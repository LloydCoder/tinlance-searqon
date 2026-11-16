# ADR-0001: Domain Observation, Finding, Action and Confidence Contracts

- Status: Accepted for the current implementation baseline
- Date: 2026-11-16
- Scope: Phase 3 — domain contract reconciliation
- Supersedes: None

## Context

Searqon already publishes strict JSON Schema contracts and validates evidence records at runtime. The approved future-module design introduced additional concepts, including `agent_simulation`, claim verdicts, recommendation lifecycle states, execution modes and confidence bands. Those concepts do not all map safely onto the existing v1 enums.

A schema/runtime mismatch would create invalid records, silently change consumer expectations or make historical observations ambiguous. The existing GEO contract is intentionally narrower than the general evidence contract.

## Decisions

### 1. Preserve the existing v1 observation classes

The v1 evidence record and assessment report accept exactly:

- `crawl`
- `first_party`
- `consumer_observation`
- `model_api`
- `derived`
- `estimate`

The v1 GEO observation accepts only `consumer_observation` and `model_api`. The GEO subset is deliberate: a GEO sample is an observed answer, not a crawl or an agent execution.

`agent_simulation` is reserved for a future, separately versioned simulation-run contract. It is not accepted by the v1 evidence or GEO runtime merely because it appears in the future architecture. When the sandbox is implemented, its evidence model must distinguish the simulation run, individual journey steps and any acquired source evidence; it must not collapse those records into an unqualified observation.

### 2. Separate claim verdicts from finding lifecycle

The proposed `findingStatus` enum mixed semantic claim judgments with the operational state of a finding. These are different dimensions.

Future claim analysis uses a `claimVerdict` vocabulary:

- `supported`
- `contradicted`
- `ambiguous`
- `stale`
- `unverifiable`

A future finding lifecycle is a separate field and must be defined only when a workflow consumes it. It must not reuse claim verdict values to mean that a finding is open, accepted, dismissed or resolved.

### 3. Keep recommendation action state separate

The future recommendation/action lifecycle is:

`proposed → validated → approved → applied → verified`

with terminal alternatives `rejected` and `rolled_back`.

This lifecycle is not a current v1 finding status. Approval must bind the actor, target, scope, diff hash and expiry. A model response or discovered endpoint cannot transition an action to an approved or applied state.

### 4. Separate execution mode from mutation approval

The sandbox execution modes are:

- `passive`
- `simulated_read_only`

Mutation is not a general execution mode. It is a separately authorized operation-level capability requiring explicit approval, staging, synthetic data, rollback and an audit record. No v1 scanner path may execute MCP tools or API operations.

### 5. Add a confidence band without rewriting legacy assessment confidence

The v1 assessment schema currently uses `none`, `heuristic`, `medium` and `high`. These values have existing semantics and remain unchanged.

Future claim/finding contracts may use:

- `high`
- `medium`
- `low`
- `insufficient`

There is no automatic one-to-one migration from the v1 assessment confidence values. In particular, `heuristic` is a methodology descriptor, not a statistically calibrated confidence band; `none` is not automatically interchangeable with `insufficient`.

Every future confidence field must identify its method, sample basis, uncertainty and limitations.

## Versioning and compatibility

1. Existing v1 schema identifiers and accepted enum sets are frozen.
2. A change that expands a strict enum is treated as a compatibility change, even if it appears additive. It requires an explicit schema-version decision and migration tests.
3. New concepts should use a new schema or versioned event contract rather than overloading an existing field.
4. Producers and consumers must validate schema version before interpreting a record.
5. Historical records remain valid under the schema version with which they were created; migrations must be explicit and lossless or document any loss.
6. Runtime constants are the canonical code-level enum source for their module; regression tests compare them with every corresponding published schema location.

## Domain boundaries

- `EvidenceRecord`: immutable-by-contract metadata describing a source observation and its provenance; a digest alone does not establish authenticity or WORM immutability.
- `AssessmentReport`: versioned results from deterministic, scoped rule evaluation, with coverage and limitations.
- `GeoObservation`: one supplied answer observation with provider/surface provenance; consumer observations and model API observations remain separate.
- `RecommendationAction`: a proposed remediation and its separately governed approval/application lifecycle.
- `AgentSimulationRun` (future): a scoped, authorized, isolated journey execution record; it is not part of the v1 scanner.

Tinlyt may provide optional acquisition adapters. TAS retains identity, authorization, policy and execution authority. Searqon owns interpretation and evidence contracts.

## Security and privacy implications

- All source content, repository files, tool descriptions, model outputs and observations remain untrusted data.
- No contract enum grants authorization or execution capability.
- Simulation requires explicit, time-bounded scope and isolated workers; passive analysis remains the default.
- Secrets and raw credentials are excluded from evidence records and logs.
- Prompt/answer retention, deletion and redaction must be explicit before persistent GEO monitoring is introduced.
- Tenant identifiers and authorization decisions must be enforced at storage, queue and worker boundaries before hosted multi-tenancy.

## Verification

- `test/domain-contracts.test.js` compares runtime observation-class constants with the evidence, assessment and GEO schemas.
- Existing evidence, GEO, assessment, MCP snapshot and remote-scan schema tests remain required.
- CI on the exact PR head must pass on Node.js 22 and 24; CodeQL and full-history secret scanning must also pass.
- This ADR resolves the v1 enum compatibility decision. It does not claim that future claim analysis, alerts, compiler or sandbox modules are implemented.
