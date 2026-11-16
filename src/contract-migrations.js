const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+$/;
const CONTRACT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertVersion(value, label) {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new TypeError(label + " must be a semantic version in MAJOR.MINOR.PATCH form");
  }
}

function assertContract(value) {
  if (typeof value !== "string" || !CONTRACT_PATTERN.test(value)) {
    throw new TypeError("contract must be a lowercase identifier using letters, digits and hyphens");
  }
}

function assertJsonValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("value must be JSON-compatible");
    return;
  }
  if (typeof value !== "object" || seen.has(value)) throw new TypeError("value must be JSON-compatible");
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("value must be a JSON-compatible object");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("value must be JSON-compatible");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("value must not contain accessors");
    assertJsonValue(descriptor.value, seen);
  }
  seen.delete(value);
}

function cloneJson(value) {
  assertJsonValue(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export class ContractMigrationRegistry {
  #edges = new Map();

  register({ contract, fromVersion, toVersion, migrate }) {
    assertContract(contract);
    assertVersion(fromVersion, "fromVersion");
    assertVersion(toVersion, "toVersion");
    if (fromVersion === toVersion) throw new TypeError("migration source and target versions must differ");
    if (typeof migrate !== "function") throw new TypeError("migrate must be a function");

    const key = contract + ":" + fromVersion + "->" + toVersion;
    if (this.#edges.has(key)) throw new Error("migration edge is already registered");

    this.#edges.set(key, Object.freeze({ contract, fromVersion, toVersion, migrate }));
    return this;
  }

  list() {
    const entries = [...this.#edges.values()]
      .map(({ contract, fromVersion, toVersion }) => Object.freeze({ contract, fromVersion, toVersion }))
      .sort((a, b) => a.contract.localeCompare(b.contract) || a.fromVersion.localeCompare(b.fromVersion) || a.toVersion.localeCompare(b.toVersion));
    return Object.freeze(entries);
  }

  migrate(contract, input, { fromVersion, toVersion } = {}) {
    assertContract(contract);
    assertVersion(fromVersion, "fromVersion");
    assertVersion(toVersion, "toVersion");
    const source = cloneJson(input);
    if (!source || Array.isArray(source) || typeof source !== "object") {
      throw new TypeError("migration input must be a JSON-compatible object");
    }
    if (Object.hasOwn(source, "schemaVersion") && source.schemaVersion !== fromVersion) {
      throw new Error("record schemaVersion does not match requested source version");
    }
    if (fromVersion === toVersion) return source;

    const edges = [...this.#edges.values()].filter(edge => edge.contract === contract);
    const paths = [];
    const walk = (version, path, visited) => {
      if (paths.length > 1) return;
      if (version === toVersion) {
        paths.push(path);
        return;
      }
      for (const edge of edges) {
        if (edge.fromVersion !== version || visited.has(edge.toVersion)) continue;
        const nextVisited = new Set(visited);
        nextVisited.add(edge.toVersion);
        walk(edge.toVersion, [...path, edge], nextVisited);
      }
    };
    walk(fromVersion, [], new Set([fromVersion]));

    if (paths.length === 0) throw new Error("No migration path is registered for the requested contract versions");
    if (paths.length > 1) throw new Error("Ambiguous migration path; register a single explicit version route");

    let current = source;
    for (const edge of paths[0]) {
      const result = edge.migrate(deepFreeze(cloneJson(current)));
      if (result && typeof result.then === "function") throw new TypeError("migration functions must be synchronous");
      const next = cloneJson(result);
      if (!next || Array.isArray(next) || typeof next !== "object") {
        throw new TypeError("migration must return a JSON-compatible object");
      }
      if (Object.hasOwn(next, "schemaVersion") && next.schemaVersion !== edge.toVersion) {
        throw new Error("migration output schemaVersion must match its registered target version");
      }
      current = next;
    }
    return current;
  }
}
