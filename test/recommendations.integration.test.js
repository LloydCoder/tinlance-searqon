import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createWorkspaceService } from "../src/platform/workspaces.js";
import { createRecommendationService } from "../src/platform/recommendations.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("recommendations preserve tenant scope, human approval, evidence verification and re-open history", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const database = { pool: new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 2 }) };
  const workspace = createWorkspaceService({ database });
  const service = createRecommendationService({ database });
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const slug = () => "recommend-" + randomUUID().replaceAll("-","").slice(0,20);
  const email = id => id + "@recommendation.example.test";
  const htmlMissing = '<html lang="en"><head><title>Example documentation for customers and products</title></head><body><h1>Documentation</h1></body></html>';
  const htmlFixed = '<html lang="en"><head><title>Example documentation for customers and products</title><meta name="description" content="Documentation for customers using the example product and its features."></head><body><h1>Documentation</h1></body></html>';

  async function assess(projectId, content) {
    await new Promise(resolve => setTimeout(resolve, 15));
    return workspace.createAssessment(userA,projectId,{contentType:"text/html",content});
  }

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Recommendation Owner'),($3,$4,'Other Owner'),($5,$6,'Recommendation Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Recommendation Org A',$2),($3,'Recommendation Org B',$4)",
      [orgA,slug(),orgB,slug()]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );
    await owner.query(
      `INSERT INTO searqon.subscriptions
        (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,current_period_start,current_period_end)
       VALUES ($1,'manual','customer-recommendation-a','subscription-recommendation-a','active','growth','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')`,
      [orgA]
    );
    const project = await workspace.createProject(userA,{
      organizationId:orgA,name:"Recommendation project",targetUrl:"https://example.com/docs"
    });

    const baseline = await assess(project.id,htmlMissing);
    const generated = await service.syncFromAssessment(userA,project.id,baseline.id);
    assert.ok(generated.counts.created > 0);
    const recommendation = generated.created.find(item => item.ruleId === "html.meta_description.missing");
    assert.ok(recommendation);
    assert.equal(recommendation.status,"open");
    const assignees = await service.listAssignees(userA,project.id);
    assert.ok(assignees.some(member=>member.id===viewer && member.role==="viewer"));
    const scheduled = await service.updateWork(userA,recommendation.id,{assignedTo:viewer,dueDate:"2026-12-01"});
    assert.equal(scheduled.assignedTo,viewer);
    assert.equal(scheduled.dueDate,"2026-12-01");
    await assert.rejects(
      service.updateWork(userA,recommendation.id,{assignedTo:userB}),
      error=>error.code==="assignee_not_in_workspace"
    );
    const cleared = await service.updateWork(userA,recommendation.id,{assignedTo:null,dueDate:null});
    assert.equal(cleared.assignedTo,null);
    assert.equal(cleared.dueDate,null);
    const replay = await service.syncFromAssessment(userA,project.id,baseline.id);
    assert.ok(replay.replayed.some(item => item.id === recommendation.id && item.idempotentReplay));

    await assert.rejects(
      service.syncFromAssessment(viewer,project.id,baseline.id),
      error => error.code === "insufficient_role"
    );
    assert.equal((await service.list(viewer,project.id)).length,generated.created.length);
    await assert.rejects(
      service.list(userB,project.id),
      error => error.code === "project_not_found"
    );
    await assert.rejects(
      service.transition(userB,recommendation.id,"accepted"),
      error => error.code === "recommendation_not_found"
    );

    const accepted = await service.transition(userA,recommendation.id,"accepted");
    assert.equal(accepted.status,"accepted");
    const working = await service.transition(userA,recommendation.id,"in_progress");
    assert.equal(working.status,"in_progress");
    await assert.rejects(
      service.transition(userA,recommendation.id,"verified"),
      error => error.code === "invalid_recommendation_status"
    );

    const repeated = await assess(project.id,htmlMissing);
    await service.syncFromAssessment(userA,project.id,repeated.id);
    const afterRepeat = (await service.list(userA,project.id)).find(item => item.id === recommendation.id);
    assert.equal(afterRepeat.occurrenceCount,2);
    assert.equal(afterRepeat.latestAssessmentId,repeated.id);

    const methodologyMismatch = await assess(project.id,htmlMissing);
    await owner.query(
      "UPDATE searqon.assessments SET report=jsonb_set(report,'{rulesVersion}',to_jsonb('test-methodology-change'::text)) WHERE id=$1",
      [methodologyMismatch.id]
    );
    await assert.rejects(
      service.verify(userA,recommendation.id,methodologyMismatch.id),
      error => error.code === "verification_methodology_mismatch"
    );

    const stillPresent = await assess(project.id,htmlMissing);
    const failedVerification = await service.verify(userA,recommendation.id,stillPresent.id);
    assert.equal(failedVerification.status,"not_resolved");
    assert.equal(failedVerification.verificationResult.result,"finding_present");

    const fixed = await assess(project.id,htmlFixed);
    const verified = await service.verify(userA,recommendation.id,fixed.id);
    assert.equal(verified.status,"verified");
    assert.equal(verified.verificationResult.result,"finding_absent");
    assert.equal(verified.verificationAssessmentId,fixed.id);

    const regressed = await assess(project.id,htmlMissing);
    const reopened = await service.syncFromAssessment(userA,project.id,regressed.id);
    const current = (await service.list(userA,project.id)).find(item => item.id === recommendation.id);
    assert.equal(current.status,"open");
    assert.equal(current.latestAssessmentId,regressed.id);
    assert.ok(reopened.updated.some(item => item.id === recommendation.id));

    const history = await service.history(viewer,recommendation.id);
    const eventTypes = history.map(item => item.eventType);
    for (const expected of ["created","assignment_changed","due_date_changed","status_changed","finding_reobserved","verification_failed","verification_succeeded","reopened"]) {
      assert.ok(eventTypes.includes(expected), "missing recommendation event " + expected);
    }
    await assert.rejects(
      owner.query("UPDATE searqon.recommendation_events SET metadata='{}'::jsonb WHERE organization_id=$1 AND recommendation_id=$2",[orgA,recommendation.id]),
      /append-only/
    );
  } finally {
    await database.pool.end();
    await owner.end();
  }
});
