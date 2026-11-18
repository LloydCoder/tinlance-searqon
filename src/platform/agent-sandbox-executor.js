import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const CHILD_PATH = fileURLToPath(new URL("./agent-sandbox-child.js",import.meta.url));
const SOURCE_DIRECTORY = resolve(dirname(CHILD_PATH),"..");
const PACKAGE_JSON = resolve(SOURCE_DIRECTORY,"..","package.json");
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

export class AgentSandboxExecutionError extends Error {
  constructor(code,message) {
    super(message);
    this.name = "AgentSandboxExecutionError";
    this.code = code;
  }
}

export function runAgentSimulationIsolated(manifest,{runId = null,timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new AgentSandboxExecutionError("invalid_simulation_timeout","The simulation timeout must be between 100 and 10000 milliseconds.");
  }
  let input;
  try { input = JSON.stringify({manifest,runId}); }
  catch { throw new AgentSandboxExecutionError("invalid_simulation_input","The simulation request must be JSON serializable."); }
  if (Buffer.byteLength(input,"utf8") > MAX_INPUT_BYTES) {
    throw new AgentSandboxExecutionError("simulation_input_too_large","The simulation request exceeds the worker input limit.");
  }

  return new Promise((resolveResult,rejectResult) => {
    const child = spawn(process.execPath,[
      "--permission",
      "--allow-fs-read="+SOURCE_DIRECTORY,
      "--allow-fs-read="+PACKAGE_JSON,
      "--disable-proto=throw",
      "--max-old-space-size=64",
      "--stack-size=512",
      CHILD_PATH
    ],{
      cwd:SOURCE_DIRECTORY,
      env:{PATH:process.env.PATH ?? "",NODE_ENV:"production"},
      stdio:["pipe","pipe","ignore"],
      windowsHide:true,
      shell:false
    });
    let stdout = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    const finish = (error,value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectResult(error);
      else resolveResult(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    },timeoutMs);

    child.stdout.on("data",chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new AgentSandboxExecutionError("simulation_output_too_large","The simulation child exceeded its output limit."));
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.once("error",() => {
      finish(new AgentSandboxExecutionError("simulation_child_unavailable","The isolated simulation process could not be started."));
    });
    child.once("close",(code,signal) => {
      if (settled) return;
      if (timedOut) {
        finish(new AgentSandboxExecutionError("simulation_timeout","The isolated simulation exceeded its wall-clock limit."));
        return;
      }
      let response;
      try { response = JSON.parse(stdout); }
      catch {
        finish(new AgentSandboxExecutionError("simulation_child_invalid_output","The isolated simulation process returned invalid output."));
        return;
      }
      if (code !== 0) {
        const errorCode = typeof response?.errorCode === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(response.errorCode)
          ? response.errorCode
          : "simulation_execution_failed";
        finish(new AgentSandboxExecutionError(errorCode,"The isolated simulation did not complete."));
        return;
      }
      if (signal) {
        finish(new AgentSandboxExecutionError("simulation_child_terminated","The isolated simulation process was terminated."));
        return;
      }
      finish(null,response);
    });
    child.stdin.on("error",() => {
      child.kill("SIGKILL");
      finish(new AgentSandboxExecutionError("simulation_input_write_failed","The simulation request could not be sent to its isolated process."));
    });
    child.stdin.end(input);
  });
}
