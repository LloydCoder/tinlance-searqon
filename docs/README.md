# Searqon Documentation

This index organizes the documentation by the reader's goal. Existing root-level documents remain canonical where noted; the guides below add task-oriented entry points.

## Tutorials
- [Run the local web application](WEB_APP.md)
- [Run your first local assessment](tutorials/first-assessment.md)

## How-to guides
- [Scan one authorized public URL](how-to/authorized-remote-scan.md)
- [Analyze supplied GEO observations](how-to/analyze-geo-observations.md)
- [Create a governed GEO sampling plan](how-to/create-geo-sampling-plan.md)
- [Compare GEO snapshots and generate alerts](how-to/compare-geo-snapshots-and-alerts.md)
- [Audit brand claims and citations](how-to/audit-brand-claims.md)

## Explanation
- [Assessment and evidence boundaries](explanation/assessment-boundaries.md)
- [Architecture and system boundaries](ARCHITECTURE.md)
- [Single-repository product architecture decision](adr/0002-single-repository-product.md)
- [Hosted platform database foundation](PLATFORM_DATABASE.md)
- [Product scope and intended users](PRODUCT_CHARTER.md)
- [Security policy and threat boundaries](../SECURITY.md)

## Security
- [ASVS-aligned security assessment and release gates](SECURITY_ASSESSMENT.md)

## Reference
- [CLI reference](reference/cli.md)
- [Scanner contract](SCANNER.md)
- [Assessment report schema](../schemas/assessment-report.schema.json)
- [Evidence record schema](../schemas/evidence-record.schema.json)
- [Evidence legal-hold event schema](../schemas/evidence-legal-hold-event.schema.json)
- [Evidence legal-hold journal entry schema](../schemas/evidence-legal-hold-journal-entry.schema.json)
- [Evidence legal-hold journal checkpoint schema](../schemas/evidence-legal-hold-journal-checkpoint.schema.json)
- [GEO observation schema](../schemas/geo-observation.schema.json)
- [GEO alert report schema](../schemas/geo-alert-report.schema.json)
- [GEO alert webhook event schema](../schemas/geo-alert-event.schema.json)
- [GEO delivery receipt schema](../schemas/geo-delivery-receipt.schema.json)
- [MCP snapshot schema](../schemas/mcp-snapshot.schema.json)
- [Versioned contract registry](../schemas/contract-registry.json)
- [Public API and persistence boundaries](reference/public-api-and-persistence.md)
- [Explicit contract migration registry](reference/contract-migrations.md)
- [Evidence retention evaluation](reference/evidence-retention.md)
- [Signed evidence legal holds](reference/evidence-legal-holds.md)
- [Persistent legal-hold journal and detached checkpoints](reference/evidence-legal-hold-journal.md)
- [Signed evidence redaction manifests](reference/evidence-redaction.md)
- [Persistent signed redaction journal and detached checkpoints](reference/evidence-redaction-journal.md)
- [Remote scan result schema](../schemas/remote-scan-result.schema.json)

## Project operations
- [Reporting](REPORTING.md)
- [Release process](RELEASING.md)
- [Delivery roadmap](ROADMAP.md)
- [Implementation status](EXECUTION_STATUS.md)
- [Contributing](../CONTRIBUTING.md)
- [Support](../SUPPORT.md)

## Documentation conventions

- Commands are written for the current Node.js CLI.
- Examples use repository fixtures and synthetic GEO observations.
- Security-sensitive procedures identify authorization requirements.
- A documented feature is not considered accepted or production-ready solely because code exists.

- [Architecture specification](ARCHITECTURE_SPEC.md)
- [Module contracts and acceptance criteria](MODULE_CONTRACTS.md)
- [16-phase completion roadmap](ROADMAP_16_PHASE.md)
- [ADR-0001: domain contract compatibility](adr/0001-domain-contracts.md)

- [Authentication and session security](AUTHENTICATION.md)
- [Hosted platform database foundation](PLATFORM_DATABASE.md)
