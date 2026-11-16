import { withUserTransaction } from "./database.js";
import { analyzeDocument } from "../analyzer.js";
import { validateTargetUrl } from "../security/url-policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITERS = new Set(["owner", "admin", "analyst"]);
const CONTENT_TYPES = new Set(["text/html", "text/markdown", "application/json", "application/vnd.oai.openapi+json", "application/vnd.searqon.mcp-snapshot+json"]);
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export class WorkspaceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "WorkspaceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw new WorkspaceError(400, "invalid_" + field, field + " must be a valid identifier.");
  return value;
}

function validateProjectInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError(400, "invalid_request", "Project details are required.");
  const organizationId = requireUuid(input.organizationId, "organization_id");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 160) throw new WorkspaceError(400, "invalid_project_name", "Project name must be between 1 and 160 characters.");
  if (typeof input.targetUrl !== "string" || input.targetUrl.length > 2048) throw new WorkspaceError(400, "invalid_target_url", "A target URL of at most 2048 characters is required.");
  let target;
  try { target = validateTargetUrl(input.targetUrl); }
  catch { throw new WorkspaceError(400, "invalid_target_url", "Use a valid public HTTP or HTTPS target without credentials, local addresses or reserved hosts."); }
  return { organizationId, name, targetUrl: target.href };
}

function validateAssessmentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError(400, "invalid_request", "Assessment content is required.");
  if (!CONTENT_TYPES.has(input.contentType)) throw new WorkspaceError(415, "unsupported_media_type", "Use HTML, Markdown, OpenAPI JSON or a normalized MCP metadata snapshot.");
  if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > MAX_DOCUMENT_BYTES) throw new WorkspaceError(413, "document_too_large", "Assessment content must be a string no larger than 2 MiB.");
  return { contentType: input.contentType, content: input.content };
}

function projectRow(row) {
  return { id: row.id, organizationId: row.organization_id, name: row.name, targetUrl: row.target_url, createdAt: row.created_at, updatedAt: row.updated_at };
}
function assessmentRow(row) {
  return { id: row.id, projectId: row.project_id, status: row.status, assessmentType: row.assessment_type, methodologyVersion: row.methodology_version, evidenceId: row.report?.evidence?.id ?? null, report: row.report ?? null, errorCode: row.error_code, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at };
}

export function createWorkspaceService({ database, analyze = analyzeDocument } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") throw new TypeError("A PostgreSQL database pool is required.");
  if (typeof analyze !== "function") throw new TypeError("An assessment function is required.");

  async function requireProjectWriter(client, organizationId, userId) {
    const result = await client.query("SELECT role FROM searqon.memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, userId]);
    const role = result.rows?.[0]?.role;
    if (!role) throw new WorkspaceError(404, "project_not_found", "The requested workspace was not found.");
    if (!WRITERS.has(role)) throw new WorkspaceError(403, "insufficient_role", "Your workspace role cannot create or modify projects and assessments.");
  }

  async function appendAudit(client, organizationId, userId, eventType, subjectType, subjectId, metadata = {}) {
    await client.query("INSERT INTO searqon.audit_events (organization_id, actor_user_id, event_type, subject_type, subject_id, metadata) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [organizationId, userId, eventType, subjectType, subjectId, JSON.stringify(metadata)]);
  }

  return Object.freeze({
    async listProjects(userId, organizationId) {
      requireUuid(userId, "user_id"); requireUuid(organizationId, "organization_id");
      return withUserTransaction(database.pool, userId, async client => {
        const result = await client.query("SELECT id, organization_id, name, target_url, created_at, updated_at FROM searqon.projects WHERE organization_id = $1 ORDER BY created_at DESC, id DESC", [organizationId]);
        return result.rows.map(projectRow);
      });
    },
    async createProject(userId, input) {
      requireUuid(userId, "user_id"); const project = validateProjectInput(input);
      return withUserTransaction(database.pool, userId, async client => {
        await requireProjectWriter(client, project.organizationId, userId);
        const result = await client.query("INSERT INTO searqon.projects (organization_id, name, target_url, created_by) VALUES ($1, $2, $3, $4) RETURNING id, organization_id, name, target_url, created_at, updated_at", [project.organizationId, project.name, project.targetUrl, userId]);
        const row = result.rows[0];
        await appendAudit(client, row.organization_id, userId, "project.created", "project", row.id, { targetHost: new URL(row.target_url).hostname });
        return projectRow(row);
      });
    },
    async getProject(userId, projectId) {
      requireUuid(userId, "user_id"); requireUuid(projectId, "project_id");
      return withUserTransaction(database.pool, userId, async client => {
        const result = await client.query("SELECT id, organization_id, name, target_url, created_at, updated_at FROM searqon.projects WHERE id = $1", [projectId]);
        return result.rows[0] ? projectRow(result.rows[0]) : null;
      });
    },
    async listAssessments(userId, projectId) {
      requireUuid(userId, "user_id"); requireUuid(projectId, "project_id");
      return withUserTransaction(database.pool, userId, async client => {
        const result = await client.query("SELECT id, project_id, status, assessment_type, methodology_version, report, error_code, created_at, started_at, completed_at FROM searqon.assessments WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100", [projectId]);
        return result.rows.map(assessmentRow);
      });
    },
    async createAssessment(userId, projectId, input) {
      requireUuid(userId, "user_id"); requireUuid(projectId, "project_id"); const content = validateAssessmentInput(input);
      const outcome = await withUserTransaction(database.pool, userId, async client => {
        const projectResult = await client.query("SELECT id, organization_id, target_url FROM searqon.projects WHERE id = $1", [projectId]);
        const project = projectResult.rows[0];
        if (!project) throw new WorkspaceError(404, "project_not_found", "The requested project was not found.");
        await requireProjectWriter(client, project.organization_id, userId);
        const created = await client.query("INSERT INTO searqon.assessments (organization_id, project_id, requested_by, status, assessment_type, methodology_version, started_at) VALUES ($1, $2, $3, 'running', 'combined', 'pending', now()) RETURNING id", [project.organization_id, project.id, userId]);
        const assessmentId = created.rows[0].id;
        let report;
        try {
          report = analyze({ source: project.target_url, contentType: content.contentType, content: content.content });
        } catch {
          await client.query("UPDATE searqon.assessments SET status = 'failed', methodology_version = 'unknown', error_code = 'analysis_failed', completed_at = now() WHERE id = $1", [assessmentId]);
          await appendAudit(client, project.organization_id, userId, "assessment.failed", "assessment", assessmentId);
          return { failure: true };
        }
        const updated = await client.query("UPDATE searqon.assessments SET status = 'succeeded', methodology_version = $2, report = $3::jsonb, completed_at = now() WHERE id = $1 RETURNING id, project_id, status, assessment_type, methodology_version, report, error_code, created_at, started_at, completed_at", [assessmentId, report.rulesVersion, JSON.stringify(report)]);
        await appendAudit(client, project.organization_id, userId, "assessment.completed", "assessment", assessmentId, { findingCount: report.summary.findingCount, methodologyVersion: report.rulesVersion });
        return { assessment: assessmentRow(updated.rows[0]) };
      });
      if (outcome.failure) throw new WorkspaceError(422, "assessment_failed", "The supplied document could not be assessed.");
      return outcome.assessment;
    }
  });
}
