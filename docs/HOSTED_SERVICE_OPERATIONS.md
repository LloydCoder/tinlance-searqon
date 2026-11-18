# Hosted service operations: backup, restore, retention and secrets

**Status:** Runbook and control requirements. No production database, backup target, key manager or restore exercise was configured by this change.

## Database roles and secrets

- Use separate identities for migrations, request serving, alert delivery, billing ingestion and billing processing.
- The migration owner must never be used by application or worker processes.
- Store database URLs, email credentials, encryption keys and provider secrets in an approved secret manager.
- Do not place secret values in GitHub Actions logs, Vercel environment output, support exports or application logs.
- Remote PostgreSQL TLS certificate verification must remain enabled.
- Rotate secrets with overlapping key versions and a tested rollback path.

The alert-destination keyring currently supports AES-256-GCM key versioning. A managed KMS/secret-manager adapter and external key custody are not configured. Do not treat environment variables as a production KMS.

## Backup policy proposal (requires operator approval)

Before production activation, the database owner must approve and record:

- recovery point objective (RPO) and recovery time objective (RTO);
- encrypted backup destination, geographic region and access principals;
- backup frequency and retention schedule;
- encryption key ownership, rotation, recovery and escrow;
- legal-hold and customer-deletion precedence;
- immutable or separately protected backup retention;
- restore-test frequency and evidence retention.

Use PostgreSQL-native logical or physical backup tooling appropriate to the managed database. Backups must be encrypted before leaving the database trust boundary and transferred over TLS. Never place plaintext dumps in the repository or general-purpose shared storage.

## Restore exercise

Run restore tests only in an isolated, access-controlled non-production environment:

1. Provision an isolated PostgreSQL instance at the supported version.
2. Restore the encrypted backup using the approved key-recovery procedure.
3. Apply no migrations until the restored schema and migration checksums are inspected.
4. Verify tenant RLS, owner/admin membership controls, append-only audit/ledger triggers, subscription and billing inbox consistency, evidence digest/checkpoint verification, and queue lease recovery.
5. Run application smoke tests and representative tenant-scoped read/write tests.
6. Record restore start/end times, data-loss window, failed checks, operator and corrective actions.
7. Destroy the temporary environment and securely remove temporary backup material under the approved policy.

A successful logical restore is not proof of point-in-time recovery, regional failover or disaster-recovery readiness.

## Retention and deletion

- Define data-class-specific retention periods with privacy/legal review before activation.
- Do not delete evidence under an active legal hold.
- Preserve append-only audit, usage and subscription events according to the approved legal/accounting schedule.
- Redaction from exports is not physical deletion. A deletion workflow must account for relational foreign keys, derived reports, evidence blobs, backups, provider data and audit obligations.
- Backup expiry must be separately enforced and evidenced; deleting a live row does not delete historical backups.
- Customer export/deletion requests require authenticated requester identity, tenant scope verification and an auditable completion record.

No automatic production deletion or backup expiration is enabled by this repository change.
