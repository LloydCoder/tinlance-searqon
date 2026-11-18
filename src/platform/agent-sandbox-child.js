import { simulateAgentJourney } from "../agent-sandbox.js";

globalThis.fetch = undefined;
globalThis.WebSocket = undefined;
globalThis.EventSource = undefined;
globalThis.WebTransport = undefined;

if (typeof globalThis.fetch !== "undefined"
  || typeof globalThis.WebSocket !== "undefined"
  || typeof globalThis.EventSource !== "undefined"
  || typeof globalThis.WebTransport !== "undefined"
  || !process.permission
  || process.permission.has("fs.write")
  || process.permission.has("net")
  || process.permission.has("child_process")
  || process.permission.has("worker_threads")) {
  process.stdout.write(JSON.stringify({errorCode:"sandbox_permissions_unavailable"}));
  process.exitCode = 1;
} else {
  const MAX_INPUT_BYTES = 16 * 1024;
  const MAX_OUTPUT_BYTES = 64 * 1024;
  
  let input = "";
  let inputBytes = 0;
  for await (const chunk of process.stdin) {
    inputBytes += Buffer.byteLength(chunk);
    if (inputBytes > MAX_INPUT_BYTES) {
      process.stdout.write(JSON.stringify({errorCode:"simulation_input_too_large"}));
      process.exitCode = 1;
      break;
    }
    input += chunk;
  }
  
  if (process.exitCode !== 1) {
    try {
      const request = JSON.parse(input);
      const result = simulateAgentJourney(request.manifest,{runId:request.runId});
      const output = JSON.stringify(result);
      if (Buffer.byteLength(output,"utf8") > MAX_OUTPUT_BYTES) {
        process.stdout.write(JSON.stringify({errorCode:"simulation_output_too_large"}));
        process.exitCode = 1;
      } else {
        process.stdout.write(output);
      }
    } catch (error) {
      const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : "simulation_execution_failed";
      process.stdout.write(JSON.stringify({errorCode:code}));
      process.exitCode = 1;
    }
  }
  
}
