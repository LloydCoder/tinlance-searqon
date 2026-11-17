import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createDatabase } from "../src/platform/database.js";
import { createWorkspaceService, WorkspaceError } from "../src/platform/workspaces.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("workspace projects and persisted assessments enforce tenant and role boundaries", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const database = { pool: new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 1 }) };
  const service = createWorkspaceService({ database });
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const projectA = randomUUID();
  const slug = () => "ws-" + randomUUID().replaceAll("-", "").slice(0, 20);
  const email = id => id + "@example.test";

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Owner A'),($3,$4,'Owner B'),($5,$6,'Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Org A',$2),($3,'Org B',$4)",
      [orgA,slug(),orgB,slug()]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );
    await owner.query(
      `INSERT INTO searqon.subscriptions
        (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,current_period_start,current_period_end)
       VALUES ($1,'manual','customer-workspace-a','subscription-workspace-a','active','growth','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')`,
      [orgA]
    );

    const project = await service.createProject(userA, {
      organizationId: orgA, name: "Primary website", targetUrl: "https://example.com/docs?token=private#section"
    });
    assert.equal(project.name, "Primary website");
    assert.equal(project.targetUrl, "https://example.com/docs");

    assert.equal((await service.listProjects(userA, orgA)).length, 1);
    assert.equal((await service.listProjects(userB, orgB)).length, 0);
    await assert.rejects(
      service.createProject(userA, { organizationId: orgB, name: "Cross tenant", targetUrl: "https://attacker.com" }),
      error => error instanceof WorkspaceError && error.code === "project_not_found"
    );
    await assert.rejects(
      service.createProject(viewer, { organizationId: orgA, name: "Viewer project", targetUrl: "https://viewer.com" }),
      error => error instanceof WorkspaceError && error.statusCode === 403
    );
    await assert.rejects(
      service.createProject(userA, { organizationId: orgA, name: "Local target", targetUrl: "http://127.0.0.1/admin" }),
      error => error instanceof WorkspaceError && error.code === "invalid_target_url"
    );

    const assessment = await service.createAssessment(userA, project.id, {
      contentType: "text/html",
      content: "<html lang=\"en\"><head><title>Example documentation page</title><meta name=\"description\" content=\"A documented product interface for example customers.\"></head><body><h1>Documentation</h1></body></html>"
    });
    assert.equal(assessment.status, "succeeded");
    assert.ok(assessment.evidenceId);
    assert.equal(assessment.report.schemaVersion, "1.0.0");
    assert.equal(assessment.report.evidence.source, "https://example.com/docs");
    assert.equal((await service.listAssessments(userA, project.id)).length, 1);

    const failingService = createWorkspaceService({ database, analyze() { throw new Error("synthetic analyzer failure"); } });
    await assert.rejects(
      failingService.createAssessment(userA, project.id, { contentType: "text/html", content: "<html></html>" }),
      error => error instanceof WorkspaceError && error.code === "assessment_failed"
    );
    const history = await service.listAssessments(userA, project.id);
    assert.equal(history.filter(item => item.status === "failed").length, 1, "failed assessments must remain auditable");

    await assert.rejects(
      service.createAssessment(userA, project.id, { contentType: "text/plain", content: "unsupported" }),
      error => error instanceof WorkspaceError && error.statusCode === 415
    );
    await assert.rejects(
      service.createAssessment(userA, project.id, { contentType: "text/html", content: "x".repeat(2 * 1024 * 1024 + 1) }),
      error => error instanceof WorkspaceError && error.statusCode === 413
    );

    assert.equal(await service.getProject(userB, project.id), null);
    assert.equal((await service.listAssessments(userB, project.id)).length, 0);
  } finally {
    // The disposable CI database is ephemeral. Audit events are append-only, so fixtures remain until the database is discarded.
    await database.pool.end();
    await owner.end();
  }
});
