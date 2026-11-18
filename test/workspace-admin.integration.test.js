import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createWorkspaceAdminService } from "../src/platform/workspace-admin.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("workspace invitations enforce verified-email binding, one-time acceptance, role hierarchy and audit-safe membership", { skip: !disposable }, async () => {
  const owner = new Pool({connectionString:databaseUrl});
  const database = {pool:new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl,max:2})};
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const inviteeId = randomUUID();
  const strangerId = randomUUID();
  const email = id => id+"@workspace-admin.example.test";
  const sent = [];
  const emailSender = {
    async sendWorkspaceInvitation(message) { sent.push(message); return {accepted:true}; }
  };
  const service = createWorkspaceAdminService({
    database,emailSender,publicOrigin:"https://searqon.example.test",
    now:()=>new Date("2026-11-18T12:00:00.000Z")
  });

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name,email_verified_at) VALUES ($1,$2,'Owner',now()),($3,$4,'Admin',now()),($5,$6,'Invitee',now()),($7,$8,'Stranger',now())",
      [ownerId,email(ownerId),adminId,email(adminId),inviteeId,email(inviteeId),strangerId,email(strangerId)]
    );
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Workspace Admin',$2)",
      [organizationId,"workspace-admin-"+ownerId.replaceAll("-","")]);
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'admin')",
      [organizationId,ownerId,adminId]
    );

    const invitation = await service.createInvitation(ownerId,organizationId,{email:email(inviteeId),role:"viewer",organizationName:"Workspace Admin"});
    assert.equal(invitation.email,email(inviteeId));
    assert.equal(invitation.role,"viewer");
    assert.equal(sent.length,1);
    assert.equal(new URL(sent[0].url).origin,"https://searqon.example.test");
    const token = new URL(sent[0].url).hash.slice("#token=".length);
    assert.match(token,/^[A-Za-z0-9_-]{43}$/);

    await assert.rejects(
      service.acceptInvitation(strangerId,token),
      error => error.code === "42501"
    );
    const accepted = await service.acceptInvitation(inviteeId,token);
    assert.deepEqual(accepted,{organizationId,role:"viewer"});
    await assert.rejects(service.acceptInvitation(inviteeId,token));

    const members = await service.listMembers(inviteeId,organizationId);
    assert.equal(members.length,3);
    assert.ok(members.every(member => !("email" in member)));
    assert.equal(members.find(member => member.userId===inviteeId).role,"viewer");

    assert.deepEqual(await service.updateMemberRole(ownerId,organizationId,inviteeId,"analyst"),{updated:true});
    assert.equal((await service.listMembers(ownerId,organizationId)).find(member=>member.userId===inviteeId).role,"analyst");
    await assert.rejects(service.updateMemberRole(ownerId,organizationId,ownerId,"viewer"));

    const pending = await service.createInvitation(ownerId,organizationId,{email:email(strangerId),role:"analyst",organizationName:"Workspace Admin"});
    const pendingToken = new URL(sent[1].url).hash.slice("#token=".length);
    assert.deepEqual(await service.revokeInvitation(ownerId,pending.id),{revoked:true});
    await assert.rejects(service.acceptInvitation(strangerId,pendingToken));

    await assert.rejects(
      service.createInvitation(adminId,organizationId,{email:"new-admin@example.test",role:"admin",organizationName:"Workspace Admin"}),
      error => error.code === "42501"
    );
    const adminInvitation = await service.createInvitation(adminId,organizationId,{email:"analyst@example.test",role:"analyst",organizationName:"Workspace Admin"});
    assert.equal(adminInvitation.role,"analyst");

    const invitations = await service.listInvitations(ownerId,organizationId);
    assert.ok(invitations.some(item=>item.id===invitation.id && item.acceptedAt));
    assert.ok(invitations.some(item=>item.id===pending.id && item.revokedAt));
    assert.deepEqual(await service.listInvitations(inviteeId,organizationId), []);
  } finally {
    await owner.query("DELETE FROM searqon.workspace_invitations WHERE organization_id=$1",[organizationId]).catch(()=>{});
    await owner.query("DELETE FROM searqon.audit_events WHERE organization_id=$1",[organizationId]).catch(()=>{});
    await owner.query("DELETE FROM searqon.memberships WHERE organization_id=$1",[organizationId]).catch(()=>{});
    await owner.query("DELETE FROM searqon.organizations WHERE id=$1",[organizationId]).catch(()=>{});
    await owner.query("DELETE FROM searqon.app_users WHERE id = ANY($1::uuid[])",[[ownerId,adminId,inviteeId,strangerId]]).catch(()=>{});
    await database.pool.end();
    await owner.end();
  }
});
