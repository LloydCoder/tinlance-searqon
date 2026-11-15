#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { analyzeDocument } from "./analyzer.js";
import { analyzeGeoObservation, aggregateGeoObservations } from "./geo.js";
import { scanPublicUrl } from "./remote-scan.js";
import { renderHtmlReport } from "./report-html.js";

const usage = [
  "Usage:",
  "  searqon scan <local-file> [--format mcp] [--source <label>] [--out <json-file>]",
  "  searqon scan-url <public-url> --confirm-authorized-target [--allow-redirect-origin <origin>]... [--user-agent <token>] [--out <json-file>]",
  "  searqon geo analyze <observation.json> [--out <json-file>]",
  "  searqon geo aggregate <observations.json> [--out <json-file>]",
  "  searqon report <assessment.json> [--out <html-file>]"
].join("\n");

async function readJson(file) {
  try { return JSON.parse(await readFile(file,"utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("Input file must contain valid JSON");
    throw error;
  }
}

async function emitResult(result,args) {
  const outIndex=args.indexOf("--out");
  const output=JSON.stringify(result,null,2)+"\n";
  if (outIndex < 0) { process.stdout.write(output); return; }
  const outputPath=args[outIndex+1];
  if (!outputPath || outputPath.startsWith("--")) throw new Error("--out requires a path");
  await writeFile(resolve(outputPath),output,{flag:"wx"});
}

async function runScan(args) {
  if (!args[1]) throw new Error(usage);
  const file=resolve(args[1]);
  const extension=extname(file).toLowerCase();
  const formatIndex=args.indexOf("--format");
  const format=formatIndex>=0 ? args[formatIndex+1] : null;
  if (formatIndex>=0 && format!=="mcp") throw new Error("--format currently supports only mcp");
  if (format==="mcp" && extension!==".json") throw new Error("MCP snapshot analysis requires a local .json file");
  const contentType=format==="mcp" ? "application/vnd.searqon.mcp-snapshot+json" : extension===".html" || extension===".htm" ? "text/html" : extension===".md" || extension===".markdown" ? "text/markdown" : extension===".json" ? "application/json" : "";
  if (!contentType) throw new Error("Only local .html, .htm, .md, .markdown, and .json files are supported");
  const sourceIndex=args.indexOf("--source");
  const source=sourceIndex>=0 ? args[sourceIndex+1] : basename(file);
  if (sourceIndex>=0 && (!source || source.startsWith("--"))) throw new Error("--source requires a value");
  await emitResult(analyzeDocument({source,contentType,content:await readFile(file,"utf8")}),args);
}

async function runScanUrl(args) {
  if (!args[1]) throw new Error(usage);
  if (!args.includes("--confirm-authorized-target")) throw new Error("Remote scanning requires --confirm-authorized-target to attest that you are authorized to assess this target");
  const allowedRedirectOrigins = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--allow-redirect-origin") continue;
    const origin = args[index + 1];
    if (!origin || origin.startsWith("--")) throw new Error("--allow-redirect-origin requires an origin");
    allowedRedirectOrigins.push(origin);
    index++;
  }
  const agentIndex = args.indexOf("--user-agent");
  const userAgent = agentIndex >= 0 ? args[agentIndex + 1] : undefined;
  if (agentIndex >= 0 && (!userAgent || userAgent.startsWith("--"))) throw new Error("--user-agent requires a product token");
  await emitResult(await scanPublicUrl(args[1], { userAgent, confirmAuthorizedTarget: true, allowedRedirectOrigins }), args);
}

async function runGeo(args) {
  const command=args[1], fileArg=args[2];
  if (!["analyze","aggregate"].includes(command) || !fileArg) throw new Error(usage);
  const file=resolve(fileArg);
  if (extname(file).toLowerCase()!==".json") throw new Error("GEO commands accept local .json files only");
  const input=await readJson(file);
  const result=command==="analyze" ? analyzeGeoObservation(input) : aggregateGeoObservations(input);
  await emitResult(result,args);
}

async function runReport(args) {
  if (!args[1]) throw new Error(usage);
  const file = resolve(args[1]);
  if (extname(file).toLowerCase() !== ".json") throw new Error("Report input must be a local .json assessment file");
  const html = renderHtmlReport(await readJson(file));
  const outIndex = args.indexOf("--out");
  if (outIndex < 0) {
    process.stdout.write(html);
    return;
  }
  const outputPath = args[outIndex + 1];
  if (!outputPath || outputPath.startsWith("--")) throw new Error("--out requires a path");
  await writeFile(resolve(outputPath), html, { flag: "wx" });
}

async function main() {
  const args=process.argv.slice(2);
  try {
    if (args[0]==="scan") await runScan(args);
    else if (args[0]==="scan-url") await runScanUrl(args);
    else if (args[0]==="geo") await runGeo(args);
    else if (args[0]==="report") await runReport(args);
    else { process.stderr.write(usage+"\n"); process.exitCode=2; }
  } catch (error) {
    process.stderr.write("Searqon: "+error.message+"\n");
    process.exitCode=error.message===usage ? 2 : 1;
  }
}
await main();
