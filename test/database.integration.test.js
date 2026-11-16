import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, withUserTransaction } from "../src/platform/database.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled = Boolean(databaseUrl);

test("PostgreSQL pool applies transaction-local tenant identity and RLS on real connections", { skip: !enabled }, async () => {
  const db = createDatabase({ connectionString: databaseUrl });
  const { pool } = db;
  const userA = "51000000-0000-4000-8000-000000000001";
  const userB = "51000000-0000-4000-8000-000000000002";
  const orgA = "52000000-0000-4000-8000-000000000001";
  const orgB = "52000000-0000-4000-8000-000000000002";
  const projectA = "53000000-0000-4000-8000-000000000001";
  const projectB = "53000000-0000-4000-8000-000000000002";

  try {
    await pool.query(
      "INSERT INTO searqon.app_users (id, email, display_name) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA, "db-integration-a@example.test", "Integration A", userB, "db-integration-b@example.test", "Integration B"]
    );
    await pool.query(
      "INSERT INTO searqon.organizations (id, name, slug) VALUES ($1, $2, $3), ($4, $5, $6)",
      [orgA, "Integration A", "integration-a", orgB, "Integration B", "integration-b"]
    );
    await pool.query(
      "INSERT INTO searqon.memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')",
      [orgA, userA, orgB, userB]
    );
    await pool.query(
      "INSERT INTO searqon.projects (id, organization_id, name, target_url, created_by) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
      [projectA, orgA, "Integration Project A", "https://a.example.test", userA,
        projectB, orgB, "Integration Project B", "https://b.example.test", userB]
    );

    const resultA = await withUserTransaction(pool, userA, async client => {
      await client.query("SET LOCAL ROLE searqon_app");
      const result = await client.query("SELECT id FROM searqon.projects ORDER BY id");
      return result.rows.map(row => row.id);
    });
    assert.deepEqual(resultA, [projectA]);

    const resultB = await withUserTransaction(pool, userB, async client => {
      await client.query("SET LOCAL ROLE searqon_app");
      const result = await client.query("SELECT id FROM searqon.projects ORDER BY id");
      return result.rows.map(row => row.id);
    });
    assert.deepEqual(resultB, [projectB]);

    await assert.rejects(
      withUserTransaction(pool, userA, async client => {
        await client.query("SET LOCAL ROLE searqon_app");
        await client.query(
          "INSERT INTO searqon.projects (organization_id, name, target_url, created_by) VALUES ($1, $2, $3, $4)",
          [orgB, "Unauthorized", "https://unauthorized.example.test", userA]
        );
      }),
      error => error.code === "42501"
    );

    const noIdentity = await pool.connect();
    try {
      await noIdentity.query("BEGIN");
      await noIdentity.query("SET LOCAL ROLE searqon_app");
      const result = await noIdentity.query("SELECT count(*)::int AS count FROM searqon.projects");
      assert.equal(result.rows[0].count, 0);
      await noIdentity.query("COMMIT");
    } catch (error) {
      await noIdentity.query("ROLLBACK");
      throw error;
    } finally {
      noIdentity.release();
    }
  } finally {
    await pool.query("DELETE FROM searqon.projects WHERE id = ANY($1::uuid[])", [[projectA, projectB]]);
    await pool.query("DELETE FROM searqon.memberships WHERE user_id = ANY($1::uuid[])", [[userA, userB]]);
    await pool.query("DELETE FROM searqon.organizations WHERE id = ANY($1::uuid[])", [[orgA, orgB]]);
    await pool.query("DELETE FROM searqon.app_users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
    await db.close();
  }
});
