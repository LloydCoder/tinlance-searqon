import test from "node:test";
import assert from "node:assert/strict";
import { ContractMigrationRegistry } from "../src/contract-migrations.js";

test("migrates only an explicitly registered contract version edge", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({
    contract: "assessment-report",
    fromVersion: "1.0.0",
    toVersion: "2.0.0",
    migrate: value => ({ ...value, schemaVersion: "2.0.0", coverage: { ...value.coverage, source: "migration" } })
  });

  const source = { schemaVersion: "1.0.0", coverage: { score: 80 } };
  const migrated = registry.migrate("assessment-report", source, { fromVersion: "1.0.0", toVersion: "2.0.0" });

  assert.deepEqual(migrated, {
    schemaVersion: "2.0.0",
    coverage: { score: 80, source: "migration" }
  });
  assert.deepEqual(source, { schemaVersion: "1.0.0", coverage: { score: 80 } });
});

test("rejects unknown contracts and unregistered version transitions without implicit upgrades", () => {
  const registry = new ContractMigrationRegistry();
  assert.throws(() => registry.migrate("unknown", {}, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /No migration path/);
  assert.throws(() => registry.migrate("assessment-report", { schemaVersion: "1.0.0" }, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /No migration path/);
});

test("rejects mismatched source versions and malformed contract versions", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({ contract: "assessment-report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: value => ({ ...value, schemaVersion: "2.0.0" }) });
  assert.throws(() => registry.migrate("assessment-report", { schemaVersion: "0.9.0" }, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /does not match requested source version/);
  assert.throws(() => registry.register({ contract: "assessment-report", fromVersion: "latest", toVersion: "2.0.0", migrate: value => value }), /semantic version/);
});

test("rejects duplicate edges and ambiguous multi-step migration paths", () => {
  const registry = new ContractMigrationRegistry();
  const identity = value => ({ ...value });
  registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: identity });
  assert.throws(() => registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: identity }), /already registered/);
  registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "3.0.0", migrate: identity });
  registry.register({ contract: "report", fromVersion: "2.0.0", toVersion: "4.0.0", migrate: identity });
  registry.register({ contract: "report", fromVersion: "3.0.0", toVersion: "4.0.0", migrate: identity });
  assert.throws(() => registry.migrate("report", { value: true }, { fromVersion: "1.0.0", toVersion: "4.0.0" }), /Ambiguous migration path/);
});

test("migration functions receive frozen JSON input and cannot mutate the caller value", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({
    contract: "report",
    fromVersion: "1.0.0",
    toVersion: "2.0.0",
    migrate: value => {
      assert.equal(Object.isFrozen(value), true);
      assert.equal(Object.isFrozen(value.nested), true);
      return { schemaVersion: "2.0.0", nested: value.nested };
    }
  });
  const source = { schemaVersion: "1.0.0", nested: { preserved: true } };
  assert.deepEqual(registry.migrate("report", source, { fromVersion: "1.0.0", toVersion: "2.0.0" }), { schemaVersion: "2.0.0", nested: { preserved: true } });
  assert.deepEqual(source, { schemaVersion: "1.0.0", nested: { preserved: true } });
});

test("rejects asynchronous and non-JSON migration results", () => {
  const asyncRegistry = new ContractMigrationRegistry();
  asyncRegistry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: async value => value });
  assert.throws(() => asyncRegistry.migrate("report", {}, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /must be synchronous/);

  const invalidRegistry = new ContractMigrationRegistry();
  invalidRegistry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: () => ({ value: undefined }) });
  assert.throws(() => invalidRegistry.migrate("report", {}, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /JSON-compatible/);
});

test("lists registered migration edges without exposing mutable registry state", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: value => value });
  const migrations = registry.list();
  assert.deepEqual(migrations, [{ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0" }]);
  assert.equal(Object.isFrozen(migrations), true);
  assert.equal(Object.isFrozen(migrations[0]), true);
});

test("preserves schemaVersion through every migration edge", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: value => ({ summary: value.summary }) });
  assert.throws(
    () => registry.migrate("report", { schemaVersion: "1.0.0", summary: "ok" }, { fromVersion: "1.0.0", toVersion: "2.0.0" }),
    /must preserve schemaVersion/
  );
});

test("rejects sparse arrays and non-JSON values inside records", () => {
  const registry = new ContractMigrationRegistry();
  registry.register({ contract: "report", fromVersion: "1.0.0", toVersion: "2.0.0", migrate: value => ({ ...value, schemaVersion: "2.0.0" }) });
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => registry.migrate("report", { items: sparse }, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /JSON-compatible/);
  assert.throws(() => registry.migrate("report", { value: Number.NaN }, { fromVersion: "1.0.0", toVersion: "2.0.0" }), /JSON-compatible/);
});
