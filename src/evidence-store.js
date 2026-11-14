import { constants } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createEvidenceLedgerEntry, verifyEvidenceLedger } from "./evidence-ledger.js";

export const MAX_EVIDENCE_LEDGER_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_EVIDENCE_LEDGER_ENTRY_BYTES = 16 * 1024;

const activePaths = new Set();

function freezeEntry(entry) {
  if (entry.record && typeof entry.record === "object") Object.freeze(entry.record);
  return Object.freeze(entry);
}

function parseLedgerContents(contents) {
  if (!contents) return [];
  if (!contents.endsWith("\n")) throw new Error("Evidence ledger is truncated: final line is incomplete");
  const lines = contents.slice(0, -1).split("\n");
  const entries = lines.map((line, index) => {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_EVIDENCE_LEDGER_ENTRY_BYTES) {
      throw new Error("Evidence ledger contains an invalid or oversized entry at line " + (index + 1));
    }
    try { return freezeEntry(JSON.parse(line)); }
    catch { throw new Error("Evidence ledger contains malformed JSON at line " + (index + 1)); }
  });
  const verification = verifyEvidenceLedger(entries);
  if (!verification.valid) {
    throw new Error("Evidence ledger integrity verification failed: " + verification.errors.join(", "));
  }
  return entries;
}

class EvidenceLedgerStore {
  #path;
  #handle;
  #entries;
  #tail = Promise.resolve();
  #closed = false;
  #failed = false;

  constructor(path, handle, entries) {
    this.#path = path;
    this.#handle = handle;
    this.#entries = entries;
  }

  get filePath() {
    return this.#path;
  }

  list() {
    return Object.freeze([...this.#entries]);
  }

  verify() {
    return verifyEvidenceLedger(this.#entries);
  }

  append(record) {
    if (this.#closed) return Promise.reject(new Error("Evidence ledger store is closed"));
    if (this.#failed) return Promise.reject(new Error("Evidence ledger store is unavailable after a failed write"));
    const operation = async () => {
      if (this.#closed) throw new Error("Evidence ledger store is closed");
      if (this.#failed) throw new Error("Evidence ledger store is unavailable after a failed write");
      const sequence = this.#entries.length + 1;
      const previousHash = this.#entries.at(-1)?.entryHash ?? null;
      const entry = createEvidenceLedgerEntry(record, { sequence, previousHash });
      const line = JSON.stringify(entry) + "\n";
      if (Buffer.byteLength(line, "utf8") > MAX_EVIDENCE_LEDGER_ENTRY_BYTES) {
        throw new Error("Evidence ledger entry exceeds the configured size limit");
      }
      try {
        await this.#handle.writeFile(line, { encoding: "utf8" });
        await this.#handle.sync();
      } catch (error) {
        this.#failed = true;
        throw error;
      }
      this.#entries.push(entry);
      return entry;
    };
    const pending = this.#tail.then(operation);
    this.#tail = pending.catch(() => {});
    return pending;
  }

  async close() {
    if (this.#closed) return;
    await this.#tail;
    this.#closed = true;
    activePaths.delete(this.#path);
    await this.#handle.close();
  }
}

export async function openEvidenceLedgerStore(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("filePath must be a non-empty path");
  }
  const requestedPath = resolve(filePath);
  await mkdir(dirname(requestedPath), { recursive: true, mode: 0o700 });
  const canonicalPath = join(await realpath(dirname(requestedPath)), basename(requestedPath));
  if (activePaths.has(canonicalPath)) throw new Error("Evidence ledger store is already open in this process");
  activePaths.add(canonicalPath);
  let handle;
  try {
    const flags = constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
    handle = await open(canonicalPath, flags, 0o600);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Evidence ledger path must be a regular file");
    if (metadata.size > MAX_EVIDENCE_LEDGER_FILE_BYTES) {
      throw new Error("Evidence ledger exceeds the configured file size limit");
    }
    await handle.chmod(0o600);
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents, "utf8") > MAX_EVIDENCE_LEDGER_FILE_BYTES) {
      throw new Error("Evidence ledger exceeds the configured file size limit");
    }
    const entries = parseLedgerContents(contents);
    return new EvidenceLedgerStore(canonicalPath, handle, entries);
  } catch (error) {
    activePaths.delete(canonicalPath);
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}
