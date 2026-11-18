import { createHash } from "node:crypto";
import { withUserTransaction } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RULE_ID = /^[a-z][a-z0-9_.-]{1,159}$/;
const DIMENSIONS = new Set(["SEO","AEO","GEO","AgEO"]);
const SEVERITIES = new Set(["critical","high","medium","low","info"]);
const WRITERS = new Set(["owner","admin","analyst"]);
const TRANSITIONS = Object.freeze({
  open: new Set(["accepted","in_progress","dismissed"]),
  accepted: new Set(["open","in_progress","dismissed"]),
  in_progress: new Set(["open","dismissed"]),
  dismissed: new Set(["open"]),
  not_resolved: new Set(["in_progress","dismissed","open"]),
  verified: new Set(["open"])
});
const PRIORITY = Object.freeze({ critical: 100, high: 80, medium: 60, low: 30, info: 10 });
const MAX_FINDINGS = 500;

export class RecommendationError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "RecommendationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RecommendationError(400, "invalid_" + field, field + " must be a valid identifier.");
  }
  return value;
}

function safeText(value, field, maximum) {
  if (typeof value !== "string") {
    throw new RecommendationError(422, "invalid_finding", "Assessment finding " + field + " is missing.");
  }
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if (!normalized || normalized.length > maximum) {
    throw new RecommendationError(422, "invalid_finding", "Assessment finding " + field + " is outside its allowed length.");
  }
  return normalized;
}

function stableLocation(finding) {
  const location = Object.create(null);
  for (const key of ["path","method","operationId","location","sourcePath","subject"]) {
    const value = finding[key];
    if (typeof value === "string" && value.trim()) location[key] = value.trim().slice(0, 512);
  }
  return location;
}

export function recommendationFindingKey(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)
    || typeof finding.ruleId !== "string" || !RULE_ID.test(finding.ruleId)
    || !DIMENSIONS.has(finding.dimension)) {
    throw new TypeError("A finding with a valid ruleId and dimension is required.");
  }
  const stable = JSON.stringify({
    ruleId: finding.ruleId,
    dimension: finding.dimension,
    location: stableLocation(finding)
  });
  return createHash("sha256").update(stable).digest("hex");
}

export function recommendationPriority(severity) {
  if (!Object.hasOwn(PRIORITY, severity)) throw new TypeError("Unknown recommendation severity.");
  return PRIORITY[severity];
}

export function normalizeRecommendationDueDate(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RecommendationError(400,"invalid_due_date","Due date must be a real calendar date in YYYY-MM-DD format or null.");
  }
  const [year,month,day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year,month-1,day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month-1 || parsed.getUTCDate() !== day) {
    throw new RecommendationError(400,"invalid_due_date","Due date must be a real calendar date in YYYY-MM-DD format or null.");
  }
  return value;
}

function normalizeFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)
    || !RULE_ID.test(finding.ruleId ?? "")
    || !DIMENSIONS.has(finding.dimension)
    || !SEVERITIES.has(finding.severity)) {
    throw new RecommendationError(422, "invalid_finding", "An assessment contains an unsupported finding.");
  }
  return {
    findingKey: recommendationFindingKey(finding),
    ruleId: finding.ruleId,
    dimension: finding.dimension,
    severity: finding.severity,
    priority: recommendationPriority(finding.severity),
    title: safeText(finding.title, "title", 240),
    description: safeText(finding.description, "description", 4000),
    recommendedAction: safeText(finding.recommendation, "recommendation", 4000)
  };
}

function recommendationRow(row, idempotentReplay = false) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sourceAssessmentId: row.source_assessment_id,
    latestAssessmentId: row.latest_assessment_id,
    verificationAssessmentId: row.verification_assessment_id,
    findingKey: row.finding_key,
    ruleId: row.rule_id,
    dimension: row.dimension,
    severity: row.severity,
    priority: row.priority,
    title: row.title,
    description: row.description,
    recommendedAction: row.recommended_action,
    assignedTo: row.assigned_to ?? null,
    dueDate: row.due_date ? String(row.due_date).slice(0,10) : null,
    status: row.status,
    occurrenceCount: row.occurrence_count,
    lastSeenAt: row.last_seen_at,
    verificationResult: row.verification_result,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    idempotentReplay
  };
}

async function requireProjectMembership(client, userId, projectId, write = false) {
  const result = await client.query(
    `SELECT p.id, p.organization_id, m.role
     FROM searqon.projects p
     JOIN searqon.memberships m ON m.organization_id = p.organization_id
     WHERE p.id = $1 AND m.user_id = $2`,
    [projectId,userId]
  );
  const row = result.rows?.[0];
  if (!row) throw new RecommendationError(404, "project_not_found", "The requested project was not found.");
  if (write && !WRITERS.has(row.role)) {
    throw new RecommendationError(403, "insufficient_role", "Your workspace role cannot modify recommendations.");
  }
  return row.organization_id;
}

async function appendEvent(client, {
  organizationId, projectId, recommendationId, actorUserId, eventType,
  fromStatus = null, toStatus = null, assessmentId = null, metadata = {}
}) {
  await client.query(
    `INSERT INTO searqon.recommendation_events
      (organization_id, project_id, recommendation_id, actor_user_id, event_type,
       from_status, to_status, assessment_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [organizationId,projectId,recommendationId,actorUserId,eventType,fromStatus,toStatus,assessmentId,JSON.stringify(metadata)]
  );
}

function reportFindings(report) {
  if (!report || typeof report !== "object" || !Array.isArray(report.findings)
    || report.findings.length > MAX_FINDINGS || !report.evidence
    || typeof report.evidence.contentType !== "string" || !report.assessments) {
    throw new RecommendationError(422, "invalid_assessment_report", "The assessment report is not eligible for recommendation processing.");
  }
  return report.findings.map(normalizeFinding);
}

export function createRecommendationService({ database } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }

  return Object.freeze({
    async list(userId, projectId) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      return withUserTransaction(database.pool,userId,async client => {
        await requireProjectMembership(client,userId,projectId,false);
        const result = await client.query(
          `SELECT * FROM searqon.recommendations
           WHERE project_id = $1
           ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'not_resolved' THEN 2
             WHEN 'accepted' THEN 3 WHEN 'verified' THEN 4 ELSE 5 END,
             priority DESC, updated_at DESC, id`,
          [projectId]
        );
        return result.rows.map(row => recommendationRow(row));
      });
    },

    async listAssignees(userId, projectId) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      return withUserTransaction(database.pool,userId,async client => {
        const organizationId = await requireProjectMembership(client,userId,projectId,false);
        const result = await client.query(
          `SELECT u.id,u.display_name,m.role
           FROM searqon.memberships m
           JOIN searqon.app_users u ON u.id=m.user_id
           WHERE m.organization_id=$1
           ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'analyst' THEN 2 ELSE 3 END,
             lower(u.display_name),u.id`,
          [organizationId]
        );
        return result.rows.map(row=>({id:row.id,displayName:row.display_name,role:row.role}));
      });
    },

    async updateWork(userId, recommendationId, input = {}) {
      requireUuid(userId,"user_id");
      requireUuid(recommendationId,"recommendation_id");
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new RecommendationError(400,"invalid_work_update","Provide assignment and/or dueDate fields.");
      }
      const hasAssignee = Object.hasOwn(input,"assignedTo");
      const hasDueDate = Object.hasOwn(input,"dueDate");
      if (!hasAssignee && !hasDueDate) {
        throw new RecommendationError(400,"empty_work_update","Provide at least one work-management field.");
      }
      const assignedTo = hasAssignee
        ? input.assignedTo === null ? null : requireUuid(input.assignedTo,"assignee_id")
        : undefined;
      const dueDate = hasDueDate ? normalizeRecommendationDueDate(input.dueDate) : undefined;

      return withUserTransaction(database.pool,userId,async client => {
        const currentResult = await client.query(
          "SELECT * FROM searqon.recommendations WHERE id=$1 FOR UPDATE",
          [recommendationId]
        );
        const current = currentResult.rows?.[0];
        if (!current) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        const organizationId = await requireProjectMembership(client,userId,current.project_id,true);
        if (organizationId !== current.organization_id) {
          throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        }
        if (hasAssignee && assignedTo !== null) {
          const member = await client.query(
            "SELECT 1 FROM searqon.memberships WHERE organization_id=$1 AND user_id=$2",
            [organizationId,assignedTo]
          );
          if (!member.rows.length) {
            throw new RecommendationError(422,"assignee_not_in_workspace","The assignee must be an active member of this workspace.");
          }
        }
        const previousAssignee = current.assigned_to ?? null;
        const previousDueDate = current.due_date ? String(current.due_date).slice(0,10) : null;
        const nextAssignee = hasAssignee ? assignedTo : previousAssignee;
        const nextDueDate = hasDueDate ? dueDate : previousDueDate;
        if (nextAssignee === previousAssignee && nextDueDate === previousDueDate) {
          return recommendationRow(current,true);
        }
        const updated = await client.query(
          `UPDATE searqon.recommendations
           SET assigned_to=$2,due_date=$3::date,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [recommendationId,nextAssignee,nextDueDate]
        );
        const row = updated.rows[0];
        if (nextAssignee !== previousAssignee) {
          await appendEvent(client,{organizationId,projectId:current.project_id,recommendationId,actorUserId:userId,
            eventType:"assignment_changed",
            metadata:{previousAssigneeId:previousAssignee,assignedToId:nextAssignee}});
        }
        if (nextDueDate !== previousDueDate) {
          await appendEvent(client,{organizationId,projectId:current.project_id,recommendationId,actorUserId:userId,
            eventType:"due_date_changed",
            metadata:{previousDueDate,dueDate:nextDueDate}});
        }
        return recommendationRow(row);
      });
    },

    async history(userId, recommendationId) {
      requireUuid(userId,"user_id");
      requireUuid(recommendationId,"recommendation_id");
      return withUserTransaction(database.pool,userId,async client => {
        const result = await client.query(
          `SELECT e.* FROM searqon.recommendation_events e
           JOIN searqon.recommendations r
             ON r.organization_id = e.organization_id AND r.id = e.recommendation_id AND r.project_id = e.project_id
           WHERE r.id = $1
           ORDER BY e.occurred_at,e.id`,
          [recommendationId]
        );
        if (!result.rows.length) {
          const exists = await client.query("SELECT id FROM searqon.recommendations WHERE id=$1",[recommendationId]);
          if (!exists.rows.length) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        }
        return result.rows.map(row => ({
          id: row.id,
          eventType: row.event_type,
          fromStatus: row.from_status,
          toStatus: row.to_status,
          assessmentId: row.assessment_id,
          metadata: row.metadata,
          occurredAt: row.occurred_at
        }));
      });
    },

    async syncFromAssessment(userId, projectId, assessmentId) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      requireUuid(assessmentId,"assessment_id");
      return withUserTransaction(database.pool,userId,async client => {
        const organizationId = await requireProjectMembership(client,userId,projectId,true);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[projectId + ":recommendation-sync"]);
        const assessmentResult = await client.query(
          `SELECT id,status,report,completed_at FROM searqon.assessments
           WHERE id=$1 AND project_id=$2 AND organization_id=$3`,
          [assessmentId,projectId,organizationId]
        );
        const assessment = assessmentResult.rows?.[0];
        if (!assessment) throw new RecommendationError(404,"assessment_not_found","The requested assessment was not found.");
        if (assessment.status !== "succeeded" || !assessment.completed_at) {
          throw new RecommendationError(409,"assessment_not_complete","Recommendations can only be generated from a successful assessment.");
        }
        const findings = reportFindings(assessment.report);
        const unique = new Map(findings.map(finding => [finding.findingKey,finding]));
        const created = [];
        const updated = [];
        const replayed = [];

        for (const finding of unique.values()) {
          const existingResult = await client.query(
            `SELECT * FROM searqon.recommendations
             WHERE organization_id=$1 AND project_id=$2 AND finding_key=$3
             FOR UPDATE`,
            [organizationId,projectId,finding.findingKey]
          );
          const existing = existingResult.rows?.[0];
          if (!existing) {
            const inserted = await client.query(
              `INSERT INTO searqon.recommendations
                (organization_id,project_id,source_assessment_id,latest_assessment_id,created_by,
                 finding_key,rule_id,dimension,severity,priority,title,description,recommended_action)
               VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
               ON CONFLICT (organization_id,project_id,finding_key) DO NOTHING
               RETURNING *`,
              [organizationId,projectId,assessmentId,userId,finding.findingKey,finding.ruleId,
                finding.dimension,finding.severity,finding.priority,finding.title,finding.description,finding.recommendedAction]
            );
            if (inserted.rows[0]) {
              const row = inserted.rows[0];
              await appendEvent(client,{organizationId,projectId,recommendationId:row.id,actorUserId:userId,
                eventType:"created",toStatus:"open",assessmentId,metadata:{findingKey:finding.findingKey,ruleId:finding.ruleId}});
              created.push(recommendationRow(row));
              continue;
            }
            const raced = await client.query(
              "SELECT * FROM searqon.recommendations WHERE organization_id=$1 AND project_id=$2 AND finding_key=$3 FOR UPDATE",
              [organizationId,projectId,finding.findingKey]
            );
            if (!raced.rows[0]) throw new RecommendationError(409,"recommendation_race","The recommendation changed concurrently.");
            replayed.push(recommendationRow(raced.rows[0],true));
            continue;
          }

          if (existing.latest_assessment_id === assessmentId) {
            replayed.push(recommendationRow(existing,true));
            continue;
          }
          const reopen = existing.status === "verified";
          const resume = existing.status === "not_resolved";
          const clearVerification = reopen || resume;
          const nextStatus = reopen ? "open" : resume ? "in_progress" : existing.status;
          const updatedResult = await client.query(
            `UPDATE searqon.recommendations
             SET latest_assessment_id=$2,status=$3,occurrence_count=LEAST(occurrence_count+1,1000000),
                 last_seen_at=now(),
                 verification_assessment_id=CASE WHEN $4 THEN NULL ELSE verification_assessment_id END,
                 verification_result=CASE WHEN $4 THEN NULL ELSE verification_result END,
                 verified_at=CASE WHEN $4 THEN NULL ELSE verified_at END,
                 updated_at=now()
             WHERE id=$1 RETURNING *`,
            [existing.id,assessmentId,nextStatus,clearVerification]
          );
          const row = updatedResult.rows[0];
          await appendEvent(client,{organizationId,projectId,recommendationId:row.id,actorUserId:userId,
            eventType:reopen ? "reopened" : "finding_reobserved",fromStatus:existing.status,toStatus:nextStatus,
            assessmentId,metadata:{findingKey:finding.findingKey,occurrenceCount:row.occurrence_count}});
          updated.push(recommendationRow(row));
        }
        return {
          assessmentId,
          totalFindings:unique.size,
          created,
          updated,
          replayed,
          counts:{created:created.length,updated:updated.length,replayed:replayed.length}
        };
      });
    },

    async transition(userId, recommendationId, nextStatus) {
      requireUuid(userId,"user_id");
      requireUuid(recommendationId,"recommendation_id");
      if (!["open","accepted","in_progress","dismissed"].includes(nextStatus)) {
        throw new RecommendationError(400,"invalid_recommendation_status","Use open, accepted, in_progress or dismissed; verification has a separate evidence-gated operation.");
      }
      return withUserTransaction(database.pool,userId,async client => {
        const currentResult = await client.query(
          "SELECT * FROM searqon.recommendations WHERE id=$1 FOR UPDATE",
          [recommendationId]
        );
        const current = currentResult.rows?.[0];
        if (!current) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        const organizationId = await requireProjectMembership(client,userId,current.project_id,true);
        if (organizationId !== current.organization_id) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        if (current.status === nextStatus) return recommendationRow(current,true);
        if (!TRANSITIONS[current.status]?.has(nextStatus)) {
          throw new RecommendationError(409,"invalid_status_transition","The requested recommendation status transition is not allowed.");
        }
        const updated = await client.query(
          `UPDATE searqon.recommendations SET status=$2,verification_assessment_id=NULL,verification_result=NULL,verified_at=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
          [recommendationId,nextStatus]
        );
        const row = updated.rows[0];
        await appendEvent(client,{organizationId,projectId:current.project_id,recommendationId,actorUserId:userId,
          eventType:"status_changed",fromStatus:current.status,toStatus:nextStatus,
          metadata:{findingKey:current.finding_key}});
        return recommendationRow(row);
      });
    },

    async verify(userId, recommendationId, verificationAssessmentId) {
      requireUuid(userId,"user_id");
      requireUuid(recommendationId,"recommendation_id");
      requireUuid(verificationAssessmentId,"verification_assessment_id");
      return withUserTransaction(database.pool,userId,async client => {
        const currentResult = await client.query(
          "SELECT * FROM searqon.recommendations WHERE id=$1 FOR UPDATE",
          [recommendationId]
        );
        const current = currentResult.rows?.[0];
        if (!current) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        const organizationId = await requireProjectMembership(client,userId,current.project_id,true);
        if (organizationId !== current.organization_id) throw new RecommendationError(404,"recommendation_not_found","The requested recommendation was not found.");
        if (!["accepted","in_progress","not_resolved"].includes(current.status)) {
          throw new RecommendationError(409,"recommendation_not_ready","Accept or start a recommendation before requesting verification.");
        }
        const assessments = await client.query(
          `SELECT id,status,report,completed_at FROM searqon.assessments
           WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3::uuid[])`,
          [organizationId,current.project_id,[current.latest_assessment_id,verificationAssessmentId]]
        );
        const byId = new Map(assessments.rows.map(row => [row.id,row]));
        const baseline = byId.get(current.latest_assessment_id);
        const verification = byId.get(verificationAssessmentId);
        if (!baseline || !verification || baseline.status !== "succeeded" || verification.status !== "succeeded"
          || !baseline.completed_at || !verification.completed_at) {
          throw new RecommendationError(409,"verification_assessment_invalid","Both baseline and verification assessments must be successful assessments for this project.");
        }
        if (verification.id === baseline.id || new Date(verification.completed_at) <= new Date(baseline.completed_at)) {
          throw new RecommendationError(409,"verification_not_later","Verification requires a later successful assessment.");
        }
        const before = baseline.report;
        const after = verification.report;
        if (before?.rulesVersion !== after?.rulesVersion) {
          throw new RecommendationError(409,"verification_methodology_mismatch","Verification requires matching assessment methodology versions.");
        }
        if (!before?.evidence?.contentType || before.evidence.contentType !== after?.evidence?.contentType
          || !after?.assessments?.[current.dimension]
          || after.assessments[current.dimension].status === "not_assessed") {
          throw new RecommendationError(409,"verification_scope_mismatch","The verification assessment must cover the same content type and recommendation dimension.");
        }
        const afterFindings = reportFindings(after);
        const stillPresent = afterFindings.some(finding => finding.findingKey === current.finding_key);
        const nextStatus = stillPresent ? "not_resolved" : "verified";
        const verificationResult = {
          result: stillPresent ? "finding_present" : "finding_absent",
          ruleId: current.rule_id,
          dimension: current.dimension,
          baselineAssessmentId: baseline.id,
          verificationAssessmentId: verification.id,
          methodologyVersion: after.rulesVersion ?? null
        };
        const updated = await client.query(
          `UPDATE searqon.recommendations
           SET status=$2,verification_assessment_id=$3,verification_result=$4::jsonb,
               verified_at=CASE WHEN $2='verified' THEN now() ELSE NULL END,updated_at=now()
           WHERE id=$1 RETURNING *`,
          [recommendationId,nextStatus,verificationAssessmentId,JSON.stringify(verificationResult)]
        );
        const row = updated.rows[0];
        await appendEvent(client,{organizationId,projectId:current.project_id,recommendationId,actorUserId:userId,
          eventType:stillPresent ? "verification_failed" : "verification_succeeded",
          fromStatus:current.status,toStatus:nextStatus,assessmentId:verificationAssessmentId,metadata:verificationResult});
        return recommendationRow(row);
      });
    }
  });
}
