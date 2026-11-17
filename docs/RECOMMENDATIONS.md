# Recommendations and verification

Searqon recommendations turn deterministic assessment findings into a durable, tenant-scoped worklist. They preserve the source assessment, the most recent assessment in which the finding was observed, human workflow decisions, and the later assessment used for verification.

## Lifecycle

- open: finding has been synchronized from a successful assessment.
- accepted: a workspace writer has accepted the proposed work.
- in_progress: work is being performed.
- dismissed: a workspace writer has explicitly dismissed the recommendation.
- not_resolved: a later comparable assessment still contains the finding.
- verified: a later comparable assessment no longer contains the finding.

Allowed transitions are enforced by the service and database. Verification is a separate evidence-gated operation; clients cannot set a recommendation to verified directly. A dismissed recommendation can be reopened. If a previously verified finding reappears in a later synchronized assessment, Searqon reopens the recommendation and records the reappearance event.

## Finding identity and synchronization

The recommendation fingerprint is SHA-256 over the rule identifier, discipline and stable location fields (when present). Evidence snapshot IDs are deliberately excluded so the same deterministic finding can be tracked across assessments.

Synchronization is idempotent for the same assessment. A project/finding pair has one durable recommendation record. New sightings update its latest assessment, last-seen time and occurrence count. A verified finding that reappears is reopened; a dismissed finding remains dismissed but records the new sighting.

The source assessment is retained as the first observation. The latest assessment is the most recent assessment in which the finding was observed and is the baseline for the next verification attempt.

## Verification rules

Verification requires all of the following:

1. The recommendation has been accepted or is in progress (or is already not_resolved and being rechecked).
2. The verification assessment is successful, belongs to the same tenant and project, and completed after the recommendation's latest observed baseline.
3. The content type matches the baseline assessment.
4. The recommendation's discipline was assessed in the verification report.
5. The assessment methodology version matches the baseline methodology version.

If the same finding fingerprint remains, the recommendation becomes not_resolved. If it is absent, the recommendation becomes verified. The result and both assessment IDs are retained in the recommendation row and append-only event history.

This is deliberately narrow: verification means the deterministic finding was absent in one later comparable assessment. It does not certify the whole page, prove rankings or AI citations, establish causality, or guarantee that no related issue remains. A later assessment that does not cover the same content type, discipline or methodology is rejected as inconclusive.

## Human control and security

- Only workspace owners, admins and analysts can synchronize or change recommendations.
- Workspace members with read access can view recommendations and history.
- Every lifecycle action records the authenticated actor.
- Recommendation events are append-only.
- Tenant, project and assessment references use composite foreign keys and row-level security.
- The UI renders finding content as text and does not apply patches, publish content, write to repositories, merge code or deploy changes.

## API surface

- GET /api/v1/projects/{projectId}/recommendations
- POST /api/v1/projects/{projectId}/recommendations with an assessmentId
- POST /api/v1/recommendations/{recommendationId}/status with a status
- POST /api/v1/recommendations/{recommendationId}/verify with an assessmentId
- GET /api/v1/recommendations/{recommendationId}/events

Write requests require an authenticated session and same-origin validation. The service independently enforces tenant membership and writer role.

## Remaining scope

Assignments and due dates, patch/test linkage, source-control integrations, richer cross-engine priority, multi-step remediation plans and customer validation remain future work. The feature is an evidence-linked workflow, not an autonomous remediation agent.
