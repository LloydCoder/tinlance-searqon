import { createHash, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { verifyEvidenceRedactionManifest } from "./evidence-redaction.js";

export const EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION = "1.0.0";
export const MAX_EVIDENCE_REDACTION_JOURNAL_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_EVIDENCE_REDACTION_JOURNAL_ENTRY_BYTES = 512 * 1024;

const JOURNAL_FIELDS = new Set(["schemaVersion", "sequence", "previousHash", "manifest", "entryHash"]);
const activePaths = new Set();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function publicEd25519Key(input) {
  const key = input && typeof input === "object" && input.type === "public" ? input : createPublicKey(input);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("An Ed25519 public key is required");
  return key;
}

function freezeManifest(manifest) {
  return Object.freeze({ ...manifest, evidenceIds: Object.freeze([...manifest.evidenceIds]) });
}

function freezeEntry(entry) {
  return Object.freeze({ ...entry, manifest: freezeManifest(entry.manifest) });
}

function canonicalPayload({ sequence, previousHash, manifest }) {
  return {
    schemaVersion: EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION,
    sequence,
    previousHash,
    manifest
  };
}

function createJournalEntry(manifest, { sequence, previousHash }, publicKey) {
  const verification = verifyEvidenceRedactionManifest(manifest, publicKey);
  if (!verification.valid) throw new TypeError("A valid signed redaction manifest is required");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("sequence must be a positive safe integer");
  if (sequence === 1 && previousHash !== null) throw new TypeError("The genesis journal entry previousHash must be null");
  if (sequence > 1 && (typeof previousHash !== "string" || !/^[a-f0-9]{64}$/.test(previousHash))) {
    throw new TypeError("previousHash is required after the genesis journal entry");
  }
  const payload = canonicalPayload({ sequence, previousHash, manifest: freezeManifest(manifest) });
  return freezeEntry({ ...payload, entryHash: sha256(JSON.stringify(payload)) });
}

export function verifyEvidenceRedactionJournalEntry(entry, publicKeyInput) {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_journal_entry_shape"]) });
  }
  for (const field of JOURNAL_FIELDS) if (!Object.hasOwn(entry, field)) errors.push("missing_" + field);
  for (const field of Object.keys(entry)) if (!JOURNAL_FIELDS.has(field)) errors.push("unexpected_" + field);
  if (entry.schemaVersion !== EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1) errors.push("invalid_sequence");
  if (entry.sequence === 1 && entry.previousHash !== null) errors.push("invalid_genesis_previous_hash");
  if (entry.sequence > 1 && (typeof entry.previousHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.previousHash))) {
    errors.push("invalid_previous_hash");
  }
  const manifestVerification = verifyEvidenceRedactionManifest(entry.manifest, publicKeyInput);
  if (!manifestVerification.valid) errors.push("invalid_redaction_manifest");
  if (typeof entry.entryHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.entryHash)) {
    errors.push("invalid_entry_hash");
  } else if (
    Number.isSafeInteger(entry.sequence) &&
    (entry.previousHash === null || (typeof entry.previousHash === "string" && /^[a-f0-9]{64}$/.test(entry.previousHash))) &&
    manifestVerification.valid &&
    entry.entryHash !== sha256(JSON.stringify(canonicalPayload(entry)))
  ) {
    errors.push("entry_hash_mismatch");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function verifyEvidenceRedactionJournal(entries, publicKeyInput) {
  if (!Array.isArray(entries)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["journal_must_be_an_array"]) });
  }
  const errors = [];
  const requestIds = new Set();
  let previousHash = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const verification = verifyEvidenceRedactionJournalEntry(entry, publicKeyInput);
    for (const error of verification.errors) errors.push("entry_" + index + ":" + error);
    if (!entry || typeof entry !== "object" || entry.sequence !== index + 1) {
      errors.push("entry_" + index + ":sequence_gap_or_reordering");
    }
    if (entry && typeof entry === "object" && entry.previousHash !== previousHash) {
      errors.push("entry_" + index + ":previous_hash_link_mismatch");
    }
    if (entry?.manifest?.requestId) {
      if (requestIds.has(entry.manifest.requestId)) errors.push("entry_" + index + ":duplicate_request_id");
      requestIds.add(entry.manifest.requestId);
    }
    previousHash = entry && typeof entry.entryHash === "string" ? entry.entryHash : null;
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function parseJournalContents(contents, publicKey) {
  if (!contents) return [];
  if (!contents.endsWith("\n")) throw new Error("Redaction journal is truncated: final line is incomplete");
  const lines = contents.slice(0, -1).split("\n");
  const entries = lines.map((line, index) => {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_EVIDENCE_REDACTION_JOURNAL_ENTRY_BYTES) {
      throw new Error("Redaction journal contains an invalid or oversized entry at line " + (index + 1));
    }
    try { return freezeEntry(JSON.parse(line)); }
    catch { throw new Error("Redaction journal contains malformed JSON at line " + (index + 1)); }
  });
  const verification = verifyEvidenceRedactionJournal(entries, publicKey);
  if (!verification.valid) throw new Error("Redaction journal integrity verification failed: " + verification.errors.join(", "));
  return entries;
}

class EvidenceRedactionStore {
  #path;
  #handle;
  #entries;
  #publicKey;
  #tail = Promise.resolve();
  #closed = false;
  #closing = false;
  #closePromise;
  #failed = false;
  #sizeBytes;

  constructor(path, handle, entries, sizeBytes, publicKey) {
    this.#path = path;
    this.#handle = handle;
    this.#entries = entries;
    this.#sizeBytes = sizeBytes;
    this.#publicKey = publicKey;
  }

  get filePath() {
    return this.#path;
  }

  list() {
    return Object.freeze([...this.#entries]);
  }

  listManifests() {
    return Object.freeze(this.#entries.map(entry => entry.manifest));
  }

  verify() {
    return verifyEvidenceRedactionJournal(this.#entries, this.#publicKey);
  }

  append(manifest) {
    if (this.#closed || this.#closing) return Promise.reject(new Error("Evidence redaction store is closed"));
    if (this.#failed) return Promise.reject(new Error("Evidence redaction store is unavailable after a failed write"));
    const operation = async () => {
      if (this.#closed) throw new Error("Evidence redaction store is closed");
      if (this.#failed) throw new Error("Evidence redaction store is unavailable after a failed write");
      if (this.#entries.some(entry => entry.manifest.requestId === manifest?.requestId)) {
        throw new Error("duplicate request identifier: " + manifest.requestId);
      }
      const sequence = this.#entries.length + 1;
      const previousHash = this.#entries.at(-1)?.entryHash ?? null;
      const entry = createJournalEntry(manifest, { sequence, previousHash }, this.#publicKey);
      const line = JSON.stringify(entry) + "\n";
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > MAX_EVIDENCE_REDACTION_JOURNAL_ENTRY_BYTES) {
        throw new Error("Redaction journal entry exceeds the configured size limit");
      }
      if (this.#sizeBytes + lineBytes > MAX_EVIDENCE_REDACTION_JOURNAL_FILE_BYTES) {
        throw new Error("Redaction journal exceeds the configured file size limit");
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

export async function openEvidenceRedactionStore(filePath, publicKeyInput) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath must be a non-empty path");
  const publicKey = publicEd25519Key(publicKeyInput);
  const requestedPath = resolve(filePath);
  await mkdir(dirname(requestedPath), { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(dirname(requestedPath));
  if (process.platform !== "win32" && typeof process.getuid === "function") {
    const directoryMetadata = await stat(canonicalDirectory);
    if (!directoryMetadata.isDirectory()) throw new Error("Redaction journal parent path must be a directory");
    if (directoryMetadata.uid !== process.getuid()) throw new Error("Redaction journal parent directory must be owned by the current user");
    if ((directoryMetadata.mode & 0o022) !== 0) {
      throw new Error("Redaction journal parent directory permissions must not be group- or world-writable");
    }
  }
  const canonicalPath = join(canonicalDirectory, basename(requestedPath));
  if (activePaths.has(canonicalPath)) throw new Error("Redaction journal store is already open in this process");
  activePaths.add(canonicalPath);
  let handle;
  try {
    const flags = constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);
    handle = await open(canonicalPath, flags, 0o600);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Redaction journal path must be a regular file");
    if (metadata.nlink !== 1) throw new Error("Redaction journal path must not be a hard link or have multiple links");
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new Error("Redaction journal file must be owned by the current user");
    }
    if (metadata.size > MAX_EVIDENCE_REDACTION_JOURNAL_FILE_BYTES) {
      throw new Error("Redaction journal exceeds the configured file size limit");
    }
    await handle.chmod(0o600);
    const contents = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(contents, "utf8") > MAX_EVIDENCE_REDACTION_JOURNAL_FILE_BYTES) {
      throw new Error("Redaction journal exceeds the configured file size limit");
    }
    const entries = parseJournalContents(contents, publicKey);
    return new EvidenceRedactionStore(canonicalPath, handle, entries, metadata.size, publicKey);
  } catch (error) {
    activePaths.delete(canonicalPath);
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}
