import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runAgentSimulationIsolated, AgentSandboxExecutionError } from "../src/platform/agent-sandbox-executor.js";

const manifest = {
  version:1,
  origin:"https://docs.example.test",
  documents:[{id:"home",url:"https://docs.example.test/",contentType:"text/html",content:"<title>Isolated</title><a href=\"/api.json\">API</a>"}],
  journey:[{action:"discover"},{action:"read_document",documentId:"home"}]
};

test("each simulation runs in a permission-restricted disposable Node child", async () => {
  const result = await runAgentSimulationIsolated(manifest,{runId:"30000000-0000-4000-8000-000000000001",timeoutMs:10000});
  assert.equal(result.runId,"30000000-0000-4000-8000-000000000001");
  assert.equal(result.mode,"read_only_snapshot_simulation");
  assert.equal(result.targetEgress,"none");
  assert.equal(result.mutations,"disabled");
  assert.equal(result.steps.length,2);
  assert.match(result.resultSha256,/^[a-f0-9]{64}$/);
});

test("isolated child returns bounded validation codes without leaking stack traces", async () => {
  await assert.rejects(
    runAgentSimulationIsolated({...manifest,journey:[{action:"write_file"}]},{timeoutMs:10000}),
    error=>error instanceof AgentSandboxExecutionError && error.code==="unsupported_action" && !error.message.includes("at ")
  );
});

test("isolated child rejects invalid timeout settings before spawning", async () => {
  assert.throws(
    ()=>runAgentSimulationIsolated(manifest,{timeoutMs:0}),
    error=>error instanceof AgentSandboxExecutionError && error.code==="invalid_simulation_timeout"
  );
});

test("sandbox child and simulator contain no outbound network or dynamic execution imports", async () => {
  const child = await readFile(new URL("../src/platform/agent-sandbox-child.js",import.meta.url),"utf8");
  const simulator = await readFile(new URL("../src/agent-sandbox.js",import.meta.url),"utf8");
  const forbidden = [
    "node:http","node:https","node:net","node:tls","node:dgram","node:dns",
    "node:child_process","node:worker_threads","fetch(","eval(","new Function","vm.run"
  ];
  for (const token of forbidden) {
    assert.equal(child.includes(token),false,"child must not include "+token);
    assert.equal(simulator.includes(token),false,"simulator must not include "+token);
  }
  assert.ok(child.includes("globalThis.fetch = undefined"));
  assert.ok(child.includes('process.permission.has("fs.write")'));
});

test("isolated child is terminated immediately when its queue lease is cancelled", async () => {
  const controller = new AbortController();
  const running = runAgentSimulationIsolated(manifest,{signal:controller.signal,timeoutMs:10000});
  controller.abort();
  await assert.rejects(
    running,
    error=>error instanceof AgentSandboxExecutionError && error.code==="simulation_cancelled"
  );
});

test("isolated child does not spawn when cancellation is already signalled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAgentSimulationIsolated(manifest,{signal:controller.signal}),
    error=>error instanceof AgentSandboxExecutionError && error.code==="simulation_cancelled"
  );
});
