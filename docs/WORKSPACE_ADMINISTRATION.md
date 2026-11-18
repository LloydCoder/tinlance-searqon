# Workspace administration

## Implemented API

All routes require a valid Searqon session. Mutating routes enforce same-origin requests and JSON content type.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/workspaces/:organizationId/members` | List member IDs, display names, roles and join dates |
| GET | `/api/v1/workspaces/:organizationId/invitations` | List pending and historical invitations (owner/admin only) |
| POST | `/api/v1/workspaces/:organizationId/invitations` | Invite a verified email address with admin, analyst or viewer role |
| POST | `/api/v1/workspaces/:organizationId/members/:memberUserId/role` | Change a member role |
| POST | `/api/v1/workspace-invitations/:invitationId/revoke` | Revoke a pending invitation |
| POST | `/api/v1/workspace-invitations/accept` | Accept an invitation while signed in as the invited verified email |

## Role model

- **Owner:** may invite administrators and other supported roles, change member roles and revoke invitations.
- **Admin:** may invite analysts/viewers, change analyst/viewer roles and revoke analyst/viewer invitations. Admins cannot promote administrators, demote owners or change owner/admin roles.
- **Analyst / Viewer:** may view workspace members but cannot administer invitations or roles.
- Owner assignment/transfer is deliberately excluded from the current API. A workspace must retain at least one owner; the final owner cannot be demoted.

Database functions enforce these constraints inside PostgreSQL. The application role does not receive direct membership INSERT/UPDATE privileges. Invitation creation, acceptance, revocation and role changes append workspace audit events.

## Invitation lifecycle

- Tokens contain 256 bits of randomness and are SHA-256 hashed at rest.
- Invitations expire after seven days, can be revoked, and are single-use.
- Acceptance requires an authenticated account whose verified email exactly matches the invited address.
- Reissuing an invitation revokes the previous pending invitation for that workspace/email.
- Invitation email content is escaped and sent with a stable idempotency key.
- The browser keeps the invitation token in session-scoped storage and removes the URL fragment from browser history. If sign-in opens a separate email tab, the invitee returns to the original invitation email and reopens its link after signing in; the token is not persisted in local storage or sent in HTTP referrers.
- Invitation list access is limited to workspace owners/admins. Member listings omit email addresses.

## Email delivery

Production invitation delivery uses the configured transactional email adapter. Local console delivery is available only outside production. No email provider credentials are created by this change. Production email delivery remains unavailable until the operator configures the approved sender and provider credentials.

## Deferred identity capabilities

MFA, passkeys, OAuth/OIDC and enterprise SSO are not enabled. The repository has no validated customer demand or approved identity-provider decision for these capabilities. They remain explicit follow-on controls, not silently simulated security features.
