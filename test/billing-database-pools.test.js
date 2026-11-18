import test from "node:test";
import assert from "node:assert/strict";
import { createBillingDatabasePool } from "../src/platform/billing-database-pools.js";

test("billing database pools require dedicated PostgreSQL URLs and verified TLS for remote hosts",async()=>{
  assert.throws(()=>createBillingDatabasePool("not-a-url",{role:"ingest"}));
  assert.throws(()=>createBillingDatabasePool("https://example.test",{role:"worker"}));
  assert.throws(()=>createBillingDatabasePool("postgresql://user:pass@db.example.test:5432/searqon",{role:"worker"}),
    error=>error.message.includes("certificate-verified TLS"));
  assert.throws(()=>createBillingDatabasePool("postgresql://user:pass@db.example.test:5432/searqon?sslmode=require",{role:"worker"}),
    error=>error.message.includes("certificate-verified TLS"));

  const local=createBillingDatabasePool("postgresql://user:pass@127.0.0.1:5432/searqon",{role:"ingest"});
  const remote=createBillingDatabasePool("postgresql://user:pass@db.example.test:5432/searqon?sslmode=verify-full",{role:"worker"});
  await Promise.all([local.end(),remote.end()]);
});

test("billing database pools reject invalid role names and excessive pool sizes",()=>{
  assert.throws(()=>createBillingDatabasePool("postgresql://user:pass@127.0.0.1:5432/searqon",{role:"app"}));
  assert.throws(()=>createBillingDatabasePool("postgresql://user:pass@127.0.0.1:5432/searqon",{role:"worker",max:11}));
});
