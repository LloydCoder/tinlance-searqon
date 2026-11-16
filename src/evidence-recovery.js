import { verifyEvidenceLedger } from "./evidence-ledger.js";
import { verifyEvidenceLedgerCheckpoint } from "./evidence-checkpoint.js";
import { verifyEvidenceRedactionJournal } from "./evidence-redaction-store.js";
import { verifyEvidenceRedactionJournalCheckpoint } from "./evidence-redaction-checkpoint.js";
import { deriveActiveEvidenceHolds } from "./evidence-legal-holds.js";
import { verifyEvidenceLegalHoldJournal } from "./evidence-legal-hold-store.js";
import { verifyEvidenceLegalHoldJournalCheckpoint } from "./evidence-legal-hold-checkpoint.js";

/**
 * Validate a local recovery bundle before any restored data is made available.
 * This is an integrity gate, not a backup transport, restore, or sanitization
 * implementation. It requires detached checkpoints and caller-trusted keys.
 */
export function verifyEvidenceRecoveryBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(["invalid_recovery_bundle"]),
      suppressedEvidenceIds: Object.freeze([])
    });
  }

  const errors = [];
  const {
    ledgerEntries,
    ledgerCheckpoint,
    ledgerCheckpointPublicKey,
    redactionEntries,
    redactionCheckpoint,
    redactionCheckpointPublicKey,
    manifestPublicKey,
    legalHoldEntries,
    legalHoldCheckpoint,
    legalHoldCheckpointPublicKey,
    legalHoldVerifier
  } = bundle;

  const ledgerVerification = verifyEvidenceLedger(ledgerEntries);
  if (!ledgerVerification.valid) errors.push("invalid_evidence_ledger");
  if (!ledgerCheckpoint) errors.push("missing_evidence_ledger_checkpoint");
  else {
    const checkpoint = verifyEvidenceLedgerCheckpoint(
      ledgerCheckpoint,
      ledgerEntries,
      ledgerCheckpointPublicKey
    );
    if (!checkpoint.valid) errors.push("invalid_evidence_ledger_checkpoint");
  }

  const redactionVerification = verifyEvidenceRedactionJournal(redactionEntries, manifestPublicKey);
  if (!redactionVerification.valid) errors.push("invalid_redaction_journal");
  if (!redactionCheckpoint) errors.push("missing_redaction_journal_checkpoint");
  else {
    const checkpoint = verifyEvidenceRedactionJournalCheckpoint(
      redactionCheckpoint,
      redactionEntries,
      redactionCheckpointPublicKey,
      manifestPublicKey
    );
    if (!checkpoint.valid) errors.push("invalid_redaction_journal_checkpoint");
  }

  const hasLegalHoldBundle = legalHoldEntries !== undefined ||
    legalHoldCheckpoint !== undefined ||
    legalHoldCheckpointPublicKey !== undefined ||
    legalHoldVerifier !== undefined;
  let legalHoldVerification = Object.freeze({ valid: true, errors: Object.freeze([]) });
  let activeLegalHoldEvidenceIds = [];
  if (hasLegalHoldBundle) {
    legalHoldVerification = verifyEvidenceLegalHoldJournal(legalHoldEntries, legalHoldVerifier);
    if (!legalHoldVerification.valid) errors.push("invalid_legal_hold_journal");
    if (!legalHoldCheckpoint) errors.push("missing_legal_hold_journal_checkpoint");
    else {
      const checkpoint = verifyEvidenceLegalHoldJournalCheckpoint(
        legalHoldCheckpoint,
        legalHoldEntries,
        legalHoldCheckpointPublicKey,
        legalHoldVerifier
      );
      if (!checkpoint.valid) errors.push("invalid_legal_hold_journal_checkpoint");
    }
    if (legalHoldVerification.valid) {
      try {
        activeLegalHoldEvidenceIds = deriveActiveEvidenceHolds(
          legalHoldEntries.map(entry => entry.event),
          legalHoldVerifier
        ).activeEvidenceIds;
      } catch {
        errors.push("invalid_legal_hold_state");
      }
    }
  }

  const evidenceIds = new Set();
  if (Array.isArray(ledgerEntries)) {
    for (const entry of ledgerEntries) {
      const id = entry?.record?.id;
      if (typeof id !== "string") continue;
      if (evidenceIds.has(id)) errors.push("duplicate_evidence_identifier");
      evidenceIds.add(id);
    }
  }

  for (const id of activeLegalHoldEvidenceIds) {
    if (!evidenceIds.has(id)) errors.push("legal_hold_references_unknown_evidence");
  }

  const suppressed = new Set();
  if (Array.isArray(redactionEntries)) {
    for (const entry of redactionEntries) {
      const ids = entry?.manifest?.evidenceIds;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (!evidenceIds.has(id)) errors.push("redaction_references_unknown_evidence");
        suppressed.add(id);
      }
    }
  }

  const uniqueErrors = [...new Set(errors)].sort();
  const suppressedEvidenceIds = uniqueErrors.length === 0 ? [...suppressed].sort() : [];
  const verifiedActiveLegalHoldEvidenceIds = uniqueErrors.length === 0 ? [...activeLegalHoldEvidenceIds].sort() : [];
  return Object.freeze({
    valid: uniqueErrors.length === 0,
    errors: Object.freeze(uniqueErrors),
    ledger: Object.freeze({
      valid: ledgerVerification.valid,
      entryCount: Array.isArray(ledgerEntries) ? ledgerEntries.length : 0
    }),
    redactions: Object.freeze({
      valid: redactionVerification.valid,
      entryCount: Array.isArray(redactionEntries) ? redactionEntries.length : 0
    }),
    suppressedEvidenceIds: Object.freeze(suppressedEvidenceIds),
    legalHolds: Object.freeze({
      included: hasLegalHoldBundle,
      valid: legalHoldVerification.valid,
      entryCount: Array.isArray(legalHoldEntries) ? legalHoldEntries.length : 0
    }),
    activeLegalHoldEvidenceIds: Object.freeze(verifiedActiveLegalHoldEvidenceIds)
  });
}
