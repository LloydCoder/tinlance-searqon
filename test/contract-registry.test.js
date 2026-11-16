import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";

const root = new URL("../", import.meta.url);
const schemasDir = new URL("../schemas/", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("contract registry accounts for every published schema and preserves exact identities", async () => {
  const registry = await readJson(new URL("../schemas/contract-registry.json", import.meta.url));
  const files = (await readdir(schemasDir)).filter(name => name.endsWith(".schema.json")).sort();
  const registered = registry.contracts.map(item => item.file).sort();

  assert.equal(registry.registryVersion, "1.0.0");
  assert.deepEqual(registered, files);
  assert.equal(new Set(registered).size, registered.length);

  for (const contract of registry.contracts) {
    const schema = await readJson(new URL("../schemas/" + contract.file, import.meta.url));
    assert.equal(schema.$id, contract.schemaId, contract.name + " schema identity");
    assert.match(contract.contractVersion, /^\d+\.\d+\.\d+$/);
    if (contract.versionField) {
      assert.equal(schema.properties?.[contract.versionField]?.const, contract.contractVersion, contract.name + " version field");
    } else {
      assert.equal(schema.properties?.schemaVersion, undefined, contract.name + " must not claim an absent version field");
    }
  }
});

test("local schema references resolve to a registered contract", async () => {
  const registry = await readJson(new URL("../schemas/contract-registry.json", import.meta.url));
  const registered = new Set(registry.contracts.map(item => item.file));
  for (const contract of registry.contracts) {
    const schema = await readJson(new URL("../schemas/" + contract.file, import.meta.url));
    const refs = [];
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) refs.push(value.$ref);
      for (const child of Object.values(value)) visit(child);
    };
    visit(schema);
    for (const ref of refs) {
      assert.ok(!ref.includes("://"), "external schema reference must be explicitly reviewed: " + ref);
      const target = basename(ref.split("#", 1)[0]);
      assert.ok(registered.has(target), contract.name + " has unregistered reference " + ref);
      await readJson(new URL("../schemas/" + target, import.meta.url));
    }
  }
});

test("contract registry forbids implicit upgrades and defines explicit migration behavior", async () => {
  const registry = await readJson(new URL("../schemas/contract-registry.json", import.meta.url));
  const policy = registry.compatibilityPolicy;
  assert.equal(policy.immutablePublishedVersions, true);
  assert.match(policy.breakingChangeRule, /new major/i);
  assert.match(policy.migrationRule, /No implicit migration/i);
  assert.match(policy.unknownVersionRule, /Reject unknown contract versions/i);
});
