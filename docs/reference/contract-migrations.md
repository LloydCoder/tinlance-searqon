# Contract migration registry

The contract migration registry provides an explicit, in-process mechanism for moving a JSON contract record between named semantic versions. It does not automatically upgrade stored records, select the latest schema, validate a record against JSON Schema, or persist a migration.

## Safety properties

- Every migration edge is registered explicitly with a contract name, source version, target version and synchronous transform.
- Versions must be exact MAJOR.MINOR.PATCH strings. Unknown versions and unregistered paths are rejected.
- A migration request must state both source and target versions. No implicit latest upgrade exists.
- Duplicate edges and ambiguous multi-step routes are rejected rather than selected by registration order.
- The input must be a JSON-compatible object. The caller's object is cloned and is never mutated.
- Each transform receives a deeply frozen clone. Its output is cloned and checked as JSON-compatible before the next edge runs.
- If a record carries a schemaVersion property, its source and each migrated target value must match the requested edge versions.
- Transforms are synchronous. Async work, I/O, network calls and side effects are outside this registry's contract.
- The registry lists edge metadata only; it never exposes transform functions or mutable internal state.

The framework cannot prove that arbitrary transform code is deterministic or lossless. Those properties must be established by fixture tests and review for every registered migration. It also does not authenticate the input record or replace schema validation by the producer/consumer.

## API

```js
import { ContractMigrationRegistry } from "./src/contract-migrations.js";

const migrations = new ContractMigrationRegistry();

migrations.register({
  contract: "example-report",
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  migrate: oldRecord => ({
    ...oldRecord,
    schemaVersion: "2.0.0",
    summary: oldRecord.summary ?? null
  })
});

const upgraded = migrations.migrate(
  "example-report",
  oldRecord,
  { fromVersion: "1.0.0", toVersion: "2.0.0" }
);
```

The example is illustrative; it is not a migration registered for any published Searqon schema. No current production schema migration is advertised. Existing v1 contracts remain immutable until a separately reviewed new schema version and its migration fixtures are published.

## Required review for each real migration

1. Identify the exact source and target schema IDs and versions in schemas/contract-registry.json.
2. Define whether the transformation is lossless. If information is removed or synthesized, document the field-level behavior and require explicit caller acceptance.
3. Validate source records before migration and validate outputs against the target schema after migration.
4. Add representative fixtures: minimal, fully populated, optional-field absent, boundary values, unknown fields, and historically malformed inputs.
5. Test deterministic repeated output, provenance preservation, non-mutation, idempotence where applicable, and explicit rejection of unsupported paths.
6. Test downstream consumer behavior against the target schema; do not infer compatibility from schema validity alone.
7. Keep source records and schema versions available for historical validation. Do not rewrite evidence-ledger history in place.

The registry is a pure transformation utility. Persistence, batch orchestration, audit logging, authorization, schema validation and rollback belong to the calling application and must be designed separately.
