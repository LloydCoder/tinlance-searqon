import { createHash, randomBytes } from "node:crypto";
import { withUserTransaction } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ROLES = new Set(["admin","analyst","viewer"]);
const MAX_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class WorkspaceAdminError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "WorkspaceAdminError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new WorkspaceAdminError(400,"invalid_"+field,field+" must be a valid identifier.");
  }
  return value;
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new WorkspaceAdminError(400,"invalid_email","Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !EMAIL.test(email)) {
    throw new WorkspaceAdminError(400,"invalid_email","Enter a valid email address.");
  }
  return email;
}

function tokenHash(token) {
  return createHash("sha256").update(token,"utf8").digest();
}

function trustedNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The trusted server clock must return a valid Date.");
  }
  return value;
}

export function createWorkspaceAdminService({
  database,
  emailSender,
  publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? "http://127.0.0.1:4173",
  now = () => new Date()
} = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  if (!emailSender || typeof emailSender.sendWorkspaceInvitation !== "function") {
    throw new TypeError("A workspace invitation email sender is required.");
  }
  if (typeof now !== "function") throw new TypeError("A trusted server clock is required.");
  const parsedOrigin = new URL(publicOrigin);
  const origin = parsedOrigin.origin;
  if (origin !== publicOrigin.replace(/\/$/,"")
    || (parsedOrigin.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(parsedOrigin.hostname))) {
    throw new TypeError("A canonical HTTPS public application origin is required outside loopback development.");
  }

  async function requireWorkspaceRole(client,userId,organizationId,{adminOnly=false}={}) {
    const result=await client.query(
      "SELECT role FROM searqon.memberships WHERE organization_id=$1 AND user_id=$2",
      [organizationId,userId]
    );
    const role=result.rows?.[0]?.role;
    if(!role) throw new WorkspaceAdminError(404,"workspace_not_found","The requested workspace was not found.");
    if(adminOnly && !["owner","admin"].includes(role)) {
      throw new WorkspaceAdminError(403,"workspace_forbidden","Your workspace role cannot view invitation history.");
    }
    return role;
  }

  async function transaction(userId,work) {
    try {
      return await withUserTransaction(database.pool,userId,work);
    } catch (error) {
      if (error instanceof WorkspaceAdminError) throw error;
      if (error?.code === "42501") throw new WorkspaceAdminError(403,"workspace_forbidden","Your workspace role cannot perform this action.");
      if (error?.code === "23505") throw new WorkspaceAdminError(409,"workspace_conflict","The invitation or membership conflicts with existing workspace state.");
      if (error?.code === "23514") throw new WorkspaceAdminError(409,"workspace_invariant","The requested change would violate a workspace ownership invariant.");
      if (error?.code === "22023") throw new WorkspaceAdminError(400,"invalid_invitation","The invitation or role request is invalid or expired.");
      throw new WorkspaceAdminError(503,"workspace_admin_unavailable","The workspace administration request could not be completed.");
    }
  }

  return Object.freeze({
    async createInvitation(userId, organizationId, input) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      if (!input || typeof input !== "object" || Array.isArray(input) || !ROLES.has(input.role)) {
        throw new WorkspaceAdminError(400,"invalid_invitation","A supported workspace role is required.");
      }
      const email = normalizeEmail(input.email);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(trustedNow(now).getTime()+MAX_INVITATION_TTL_MS);
      const invitation = await transaction(userId,async client => {
        const created = await client.query(
          "SELECT * FROM searqon.create_workspace_invitation($1,$2,$3,$4,$5)",
          [organizationId,email,input.role,tokenHash(token),expiresAt]
        );
        const workspace = await client.query("SELECT name FROM searqon.organizations WHERE id=$1",[organizationId]);
        return created.rows?.[0] ? {...created.rows[0],organization_name:workspace.rows?.[0]?.name} : null;
      });
      if (!invitation) throw new WorkspaceAdminError(503,"invitation_unavailable","The workspace invitation could not be created.");
      const invitationUrl = new URL("/auth/invitation/",origin);
      invitationUrl.hash = "token="+token;
      try {
        await emailSender.sendWorkspaceInvitation({
          to: email,
          url: invitationUrl.toString(),
          organizationName: invitation.organization_name ?? "your workspace",
          role: invitation.invited_role,
          idempotencyKey: "searqon-workspace-invitation/"+invitation.invitation_id
        });
      } catch {
        let revoked=false;
        try {
          const result=await transaction(userId,client =>
            client.query("SELECT searqon.revoke_workspace_invitation($1) AS revoked",[invitation.invitation_id])
          );
          revoked=result.rows?.[0]?.revoked===true;
        } catch {}
        if(!revoked) {
          throw new WorkspaceAdminError(503,"invitation_delivery_state_unknown","Invitation delivery failed and the pending invitation state could not be confirmed. Ask a workspace owner to review and revoke it if necessary.");
        }
        throw new WorkspaceAdminError(503,"invitation_delivery_unavailable","The invitation could not be delivered. The pending invitation was revoked.");
      }
      return Object.freeze({
        id: invitation.invitation_id,
        email,
        role: invitation.invited_role,
        expiresAt: invitation.expires_at
      });
    },

    async listInvitations(userId, organizationId) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      return transaction(userId,async client => {
        await requireWorkspaceRole(client,userId,organizationId,{adminOnly:true});
        const result = await client.query(
          `SELECT id,invited_email,invited_role,invited_by,expires_at,accepted_at,revoked_at,created_at
           FROM searqon.workspace_invitations
           WHERE organization_id=$1
           ORDER BY created_at DESC,id DESC LIMIT 100`,
          [organizationId]
        );
        return result.rows.map(row => ({
          id:row.id,email:row.invited_email,role:row.invited_role,invitedBy:row.invited_by,
          expiresAt:row.expires_at,acceptedAt:row.accepted_at,revokedAt:row.revoked_at,createdAt:row.created_at
        }));
      });
    },

    async listMembers(userId, organizationId) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      return transaction(userId,async client => {
        await requireWorkspaceRole(client,userId,organizationId);
        const result = await client.query("SELECT * FROM searqon.list_workspace_members($1)",[organizationId]);
        return result.rows.map(row => ({
          userId:row.user_id,displayName:row.display_name,role:row.role,joinedAt:row.joined_at
        }));
      });
    },

    async revokeInvitation(userId, invitationId) {
      requireUuid(userId,"user_id");
      requireUuid(invitationId,"invitation_id");
      return transaction(userId,async client => {
        const result = await client.query("SELECT searqon.revoke_workspace_invitation($1) AS revoked",[invitationId]);
        return {revoked:result.rows?.[0]?.revoked === true};
      });
    },

    async updateMemberRole(userId, organizationId, memberUserId, role) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      requireUuid(memberUserId,"member_user_id");
      if (!ROLES.has(role)) throw new WorkspaceAdminError(400,"invalid_role","A supported workspace role is required.");
      return transaction(userId,async client => {
        const result = await client.query(
          "SELECT searqon.set_workspace_member_role($1,$2,$3) AS updated",
          [organizationId,memberUserId,role]
        );
        return {updated:result.rows?.[0]?.updated === true};
      });
    },

    async acceptInvitation(userId, rawToken) {
      requireUuid(userId,"user_id");
      if (typeof rawToken !== "string" || !TOKEN.test(rawToken)) {
        throw new WorkspaceAdminError(400,"invalid_invitation_token","The invitation link is invalid or expired.");
      }
      return transaction(userId,async client => {
        const result = await client.query(
          "SELECT * FROM searqon.accept_workspace_invitation($1)",
          [tokenHash(rawToken)]
        );
        const row = result.rows?.[0];
        if (!row) throw new WorkspaceAdminError(400,"invalid_invitation_token","The invitation link is invalid or expired.");
        return {organizationId:row.organization_id,role:row.member_role};
      });
    }
  });
}
