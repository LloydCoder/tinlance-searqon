import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withUserTransaction } from "../src/platform/database.js";
import { createAlertDestinationStore } from "../src/platform/alert-destinations.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("alert destination secrets are encrypted, unreadable to request runtime and decryptable only by worker role", { skip: !disposable }, async () => {
  const owner = new Pool({connectionString:databaseUrl});
  const runtime = new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL,max:3});
  const worker = new Pool({connectionString:process.env.SEARQON_WORKER_DATABASE_URL,max:2});
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const email = id => id+"@alert-destination.example.test";
  const keyring = {currentVersion:"test-k1",keys:{"test-k1":randomBytes(32)}};
  const store = createAlertDestinationStore({database:{pool:runtime},workerPool:worker,encryptionKeyring:keyring});
  const secret = "https://hooks.slack.com/services/T000/B000/very-secret-webhook";
  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Destination A'),($3,$4,'Destination B'),($5,$6,'Destination Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Destination A',$2),($3,'Destination B',$4)",
      [orgA,"alert-dest-"+userA.replaceAll("-",""),orgB,"alert-dest-"+userB.replaceAll("-","")]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );

    const created = await store.create(userA,orgA,{channel:"slack",displayName:"Operations alerts",secret});
    assert.equal(created.channel,"slack");
    assert.equal(created.status,"enabled");
    assert.equal("secret" in created,false);
    assert.equal("secretSha256" in created,false);
    assert.equal("secretCiphertext" in created,false);

    const listed = await store.list(userA,orgA);
    assert.equal(listed.length,1);
    assert.equal("secret" in listed[0],false);
    const ciphertext = await owner.query(
      "SELECT secret_ciphertext,secret_nonce,secret_tag,key_version,secret_sha256 FROM searqon.alert_destinations WHERE id=$1",
      [created.id]
    );
    assert.notEqual(ciphertext.rows[0].secret_ciphertext.toString("utf8"),secret);
    assert.equal(ciphertext.rows[0].key_version,"test-k1");

    await assert.rejects(
      withUserTransaction(runtime,userA,client => client.query(
        "SELECT secret_ciphertext FROM searqon.alert_destinations WHERE id=$1",[created.id]
      )),
      error => error.code === "42501"
    );
    const decrypted = await store.getForDelivery("worker-node-alerts",orgA,created.id);
    assert.equal(decrypted.secret,secret);
    assert.equal(decrypted.displayName,"Operations alerts");

    const hidden = await store.list(userB,orgA);
    assert.equal(hidden.length,0);
    await assert.rejects(
      store.create(viewer,orgA,{channel:"slack",displayName:"Viewer destination",secret}),
      error => error.code === "insufficient_role"
    );
    await assert.rejects(
      store.create(userA,orgA,{channel:"slack",displayName:"Unsafe endpoint",secret:"https://attacker.example/services/secret"}),
      error => error.code === "invalid_destination_secret"
    );

    const disabled = await store.disable(userA,orgA,created.id);
    assert.equal(disabled.status,"disabled");
    assert.equal(await store.getForDelivery("worker-node-alerts",orgA,created.id),null);

    const audit = await owner.query(
      "SELECT event_type,subject_type,subject_id FROM searqon.audit_events WHERE organization_id=$1 AND subject_id=$2 ORDER BY created_at",
      [orgA,created.id]
    );
    assert.deepEqual(audit.rows.map(row=>row.event_type),["alert_destination.created","alert_destination.disabled"]);
    assert.ok(audit.rows.every(row=>row.subject_type==="alert_destination"));
  } finally {
    await worker.end();
    await runtime.end();
    await owner.end();
  }
});
