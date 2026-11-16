import test from "node:test";
import assert from "node:assert/strict";

test("documented programmatic API exports remain available", async () => {
  const [analyzer, remote, evidence, ledger, store, checkpoint, geo, report, migrations] = await Promise.all([
    import("../src/analyzer.js"),
    import("../src/remote-scan.js"),
    import("../src/evidence.js"),
    import("../src/evidence-ledger.js"),
    import("../src/evidence-store.js"),
    import("../src/evidence-checkpoint.js"),
    import("../src/geo.js"),
    import("../src/report-html.js"),
    import("../src/contract-migrations.js")
  ]);

  for (const [module, names] of [
    [analyzer, ["analyzeDocument"]],
    [remote, ["scanPublicUrl"]],
    [evidence, ["createEvidenceRecord", "verifyEvidenceRecord", "verifyEvidenceContent", "EVIDENCE_OBSERVATION_CLASSES"]],
    [ledger, ["createEvidenceLedgerEntry", "verifyEvidenceLedgerEntry", "verifyEvidenceLedger", "EVIDENCE_LEDGER_SCHEMA_VERSION"]],
    [store, ["openEvidenceLedgerStore", "MAX_EVIDENCE_LEDGER_FILE_BYTES", "MAX_EVIDENCE_LEDGER_ENTRY_BYTES"]],
    [checkpoint, ["createEvidenceLedgerCheckpoint", "verifyEvidenceLedgerCheckpoint", "EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_VERSION"]],
    [geo, ["analyzeGeoObservation", "aggregateGeoObservations", "GEO_OBSERVATION_CLASSES"]],
    [report, ["renderHtmlReport", "escapeHtml"]],
    [migrations, ["ContractMigrationRegistry"]]
  ]) {
    for (const name of names) assert.ok(Object.hasOwn(module, name), "missing documented export " + name);
  }
});
