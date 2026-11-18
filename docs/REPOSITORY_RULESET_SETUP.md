# Main-branch repository ruleset setup

**Purpose:** close the Phase 2 repository-governance gate for the public Searqon repository.

**Current verified state (2026-11-18):** the GitHub branch metadata reports `main.protected: false`; the repository rulesets endpoint returns an empty list. This document is a configuration specification only. It does not claim that a ruleset has been applied.

## 1. Create the ruleset

In GitHub, open the repository:

1. Select **Settings**.
2. Open **Rules → Rulesets**.
3. Select **New ruleset → New branch ruleset**.
4. Name it `main-protection`.
5. Set enforcement status to **Active**.
6. Under target branches, include the default branch `main`.
7. Do not add a bypass actor for routine work.

## 2. Required rules

Enable:

- **Restrict deletions** — prevents accidental deletion of `main`.
- **Require a pull request before merging** — no direct changes to `main`.
- **Require conversation resolution** — review conversations must be resolved before merge.
- **Require linear history** — use the repository's squash-merge workflow.
- **Block force pushes** — do not allow force-push updates to `main`.
- **Require status checks to pass** — add the unique check contexts listed below.
- **Require branches to be up to date before merging** — use strict status checks.

### Required status checks

Select the check contexts exactly as shown by successful GitHub Actions runs:

| Check context | Source workflow | Requirement |
|---|---|---|
| `CI` | `.github/workflows/ci.yml` | Required |
| `CodeQL` | `.github/workflows/codeql.yml` | Required |
| `Secret scanning` | `.github/workflows/secret-scan.yml` | Required |

Do **not** add the Vercel preview/deployment check as a required source-CI check while its Hobby daily deployment quota is rate-limited. It is an external preview deployment, not a test or security workflow. Track it separately and revisit when the deployment quota is available.

### Review approvals

If a second trusted maintainer is available, require at least one approving review and dismiss stale approvals on new commits. If the repository still has only one maintainer, do not configure an impossible approval requirement; keep the PR and required-check gates active and record the missing independent reviewer as a governance limitation until another maintainer is added.

## 3. Verify after saving

Re-open the ruleset and verify:

- Enforcement is **Active**.
- Target includes only `refs/heads/main`.
- Required status checks are exactly `CI`, `CodeQL`, and `Secret scanning`.
- Pull requests, conversation resolution and linear history are required.
- Deletion and force-push updates are blocked.
- The bypass list is empty for routine workflows.

Then verify through the repository's **Settings → Rules → Rulesets** page and the GitHub REST endpoint:

```text
GET /repos/LloydCoder/tinlance-searqon/rulesets
```

Record the ruleset ID, name, enforcement state, target, required check contexts and verification timestamp in `docs/PHASE_2_OPEN_SOURCE_FOUNDATION.md`.

A branch metadata response with `protected: false` alone does not prove ruleset state; the rulesets endpoint and actual ruleset configuration must also be checked.

## 4. Why this is an external action

The connected GitHub integration available to this execution can read repository metadata and rulesets, create branches, edit repository files and manage pull requests. It does not expose a repository-ruleset create/update operation. The release workflows' `GITHUB_TOKEN` has narrowly scoped contents/attestation permissions and cannot administer repository rulesets. No personal access token or additional credential was requested, created, stored or assumed.

This step requires a repository administrator to apply the configuration in GitHub Settings. Do not mark Phase 2 complete until the active ruleset and required checks are independently re-read and recorded.
