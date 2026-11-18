# Phase 12 — Recommendation workflow evaluation protocol

**Status:** PREPARED — NOT RUN  
**Evidence status:** No customer or design-partner sessions are recorded in this repository. Do not treat this protocol as customer validation.

## Evaluation objective

Determine whether a real workspace user can turn a Searqon assessment into a prioritized, assigned, evidence-linked remediation plan and then verify the outcome with a later comparable assessment.

## Participants to recruit

Recruit actual users who own or perform website, content, API, security or AI-agent readiness work. Record the participant's role and organization only with permission. Do not fabricate participants or infer consent.

## End-to-end task

1. Run a successful assessment on a site or documentation set the participant is authorized to assess.
2. Review recommendations across SEO, AEO, GEO and AgEO; explain why the worklist order is sensible.
3. Assign an item to an eligible workspace member and set or clear a due date.
4. Create a multi-step remediation proposal that links each recommendation to an exact patch digest, dependency and test-evidence reference.
5. Ask the participant to identify whether the proposal is safe to review and what evidence is still missing.
6. Have the participant perform any remediation outside Searqon using their normal approved workflow.
7. Run a later comparable assessment and verify whether the finding remains, disappears or reappears.
8. Review the append-only history and confirm that the recorded actors, assessments and state transitions are understandable.

## Evidence to capture

For each session, record:
- Session date, participant role and organization consent status.
- Assessment IDs and the authorized target scope.
- Time to first useful recommendation and time to identify the next action.
- Whether priority order matches the participant's judgment, with reasons for disagreements.
- Assignment and due-date workflow completion or failure.
- Whether the patch, dependency and test references are understandable and correctly linked.
- Whether the participant understands that supplied test references are not independently attested and that Searqon does not apply patches or execute tests.
- Verification result and any false-positive, missed-regression or methodology-comparability issue.
- Severity, reproduction steps, impact and owner for every issue found.

## Acceptance decisions

Do not set numeric success thresholds after observing results. Before the first session, the product owner must approve the thresholds for task completion, recommendation actionability, priority agreement, evidence comprehension and acceptable defects. Preserve negative feedback and failed sessions.

Phase 12 customer evaluation is complete only when actual sessions have been performed, evidence has been recorded, material issues have dispositions, and the product owner has explicitly accepted the results. CI, synthetic fixtures, internal review and this protocol do not satisfy this gate.

## Session ledger

| Session | Date | Participant / role | Organization consent | Outcome | Evidence |
|---|---|---|---|---|---|
| — | — | No sessions recorded | — | NOT RUN | — |

## Current constraints

- No production deployment or customer data access is authorized by this protocol.
- Staging use requires explicit target authorization and a verified isolated environment.
- No patch application, test execution, source-control write, merge or publication is performed by the remediation-plan compiler.
- No external customer outcome is claimed.
