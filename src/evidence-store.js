import { constants } from "node:fs";
import { mkdir, open, realpath, stat } from "node:fs/promises";
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
  #closing = false;
  #closePromise;
  #failed = false;
  #sizeBytes;

  constructor(path, handle, entries, sizeBytes) {
    this.#path = path;
    this.#handle = handle;
    this.#entries = entries;
    this.#sizeBytes = sizeBytes;
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
    if (this.#closed || this.#closing) return Promise.reject(new Error("Evidence ledger store is closed"));
    if (this.#failed) return Promise.reject(new Error("Evidence ledger store is unavailable after a failed write"));
    const operation = async () => {
      if (this.#closed) throw new Error("Evidence ledger store is closed");
      if (this.#failed) throw new Error("Evidence ledger store is unavailable after a failed write");
      const sequence = this.#entries.length + 1;
      const previousHash = this.#entries.at(-1)?.entryHash ?? null;
      const entry = createEvidenceLedgerEntry(record, { sequence, previousHash });
      const line = JSON.stringify(entry) + "\n";
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > MAX_EVIDENCE_LEDGER_ENTRY_BYTES) {
        throw new Error("Evidence ledger entry exceeds the configured size limit");
      }
      if (this.#sizeBytes + lineBytes > MAX_EVIDENCE_LEDGER_FILE_BYTES) {
        throw new Error("Evidence ledger exceeds the configured file size limit");
      }
      try {
        await this.#handle.writeFile(line, { encoding: "utf8" });
        await this.#handle.sync();
      } catch (error) {
        this.#failed = true;
        throw error;
      }
      this.#entries.push(entry);
      this.#sizeBytes += lineBytes;
      return entry;
    };
    const pending = this.#tail.then(operation);
    this.#tail = pending.catch(() => {});
    return pending;
  }

  close() {
    if (this.#closePromise) return this.#closePromise;
    if (this.#closed) return Promise.resolve();
    // Close admission synchronously; appends already queued are drained below.
    this.#closing = true;
    this.#closePromise = (async () => {
      try {
        await this.#tail;
        this.#closed = true;
        await this.#handle.close();
      } finally {
        this.#closed = true;
        activePaths.delete(this.#path);
      }
    })();
    return this.#closePromise;
  }
}

export async function openEvidenceLedgerStore(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new TypeError("filePath must be a non-empty path");
  }
  const requestedPath = resolve(filePath);
  await mkdir(dirname(requestedPath), { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(dirname(requestedPath));
  if (process.platform !== "win32" && typeof process.getuid === "function") {
    const directoryMetadata = await stat(canonicalDirectory);
    if (!directoryMetadata.isDirectory()) {
      throw new Error("Evidence ledger parent path must be a directory");
    }
    if (directoryMetadata.uid !== process.getuid()) {
      throw new Error("Evidence ledger parent directory must be owned by the current user");
    }
    if ((directoryMetadata.mode & 0o022) !== 0) {
      throw new Error("Evidence ledger parent directory permissions must not be group- or world-writable");
    }
  }
  const canonicalPath = join(canonicalDirectory, basename(requestedPath));
  if (activePaths.has(canonicalPath)) throw new Error("Evidence ledger store is already open in this process");
  activePaths.add(canonicalPath);
  let handle;
  try {
    const flags = constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
    handle = await open(canonicalPath, flags, 0o600);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Evidence ledger path must be a regular file");
    if (metadata.nlink !== 1) throw new Error("Evidence ledger path must not be a hard link or have multiple links");
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new Error("Evidence ledger file must be owned by the current user");
    }
    if (metadata.size > MAX_EVIDENCE_LEDGER_FILE_BYTES) {
      throw new Error("Evidence ledger exceeds the configured file size limit");
    }
    await handle.chmod(0o600);
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents, "utf8") > MAX_EVIDENCE_LEDGER_FILE_BYTES) {
      throw new Error("Evidence ledger exceeds the configured file size limit");
    }
    const entries = parseLedgerContents(contents);
    return new EvidenceLedgerStore(canonicalPath, handle, entries, metadata.size);
  } catch (error) {
    activePaths.delete(canonicalPath);
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}
