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
- GET /api/v1/projects/{projectId}/recommendations/assignees
- GET /api/v1/projects/{projectId}/recommendation-plans
- POST /api/v1/projects/{projectId}/recommendation-plans
- POST /api/v1/projects/{projectId}/recommendations with an assessmentId
- POST /api/v1/recommendations/{recommendationId}/status with a status
- POST /api/v1/recommendations/{recommendationId}/work with assignedTo and/or dueDate
- POST /api/v1/recommendations/{recommendationId}/verify with an assessmentId
- GET /api/v1/recommendations/{recommendationId}/events

Write requests require an authenticated session and same-origin validation. The service independently enforces tenant membership and writer role.

## Ownership and scheduling

Workspace writers can assign a recommendation to any current member of the same workspace or clear the assignment. A due date is an optional calendar date (`YYYY-MM-DD`) with strict calendar validation; it is not a timestamp and carries no timezone. Assignment and due-date changes are recorded as separate append-only events. The assignee lookup returns only member ID, display name and workspace role. Viewers can see ownership and due dates but cannot change them.

## Remaining scope

Patch/test linkage, source-control integrations, richer cross-engine priority, multi-step remediation plans and customer validation remain future work. The feature is an evidence-linked workflow, not an autonomous remediation agent.

## Cross-engine prioritization and remediation plans

Repeated observations of the same stable finding also update its latest severity and recommendation text. A severity increase emits a separate append-only \`severity_escalated\` event; a decrease emits \`severity_deescalated\`. The finding identity remains stable because severity is not part of its fingerprint. This preserves the regression trail without creating duplicate recommendation records.


The authenticated project worklist ranks SEO, AEO, GEO and AgEO recommendations with a deterministic, explainable score. The score combines the existing severity priority, bounded recurrence, workflow state and overdue status. Verified and dismissed items receive a zero active-work score. Ties are resolved by due date and stable recommendation ID. Ranking is a presentation/work-queue signal; it does not rewrite the persisted severity or recommendation state.

A remediation plan is an immutable, tenant-scoped proposal. Each step binds one or more recommendation IDs to a repository-relative patch path, the SHA-256 digest of the exact unified-diff bytes, explicit step dependencies, and test evidence references. Test evidence must identify a successful assessment in the same project and must carry the exact patch digest. Any failed or unrun test blocks the plan from becoming ready for human review. Plans are stored as immutable snapshots with a tenant/project boundary and a content digest.

The plan compiler validates dependency acyclicity, path traversal, patch digest integrity, test-to-patch linkage, bounded input sizes and evidence references. It does not execute tests, apply patches, write to source control, open pull requests, merge, or publish. A plan marked "ready_for_human_review" means only that supplied test references are marked passed and structurally linked; it is not independent proof that tests ran or that a patch is correct. Source-control operations remain separate and require explicit human authorization.
