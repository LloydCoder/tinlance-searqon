#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { analyzeDocument } from "./analyzer.js";
import { analyzeGeoObservation, aggregateGeoObservations } from "./geo.js";

const usage = [
  "Usage:",
  "  searqon scan <local-file> [--source <label>] [--out <json-file>]",
  "  searqon geo analyze <observation.json> [--out <json-file>]",
  "  searqon geo aggregate <observations.json> [--out <json-file>]"
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
  const contentType=extension===".html" || extension===".htm" ? "text/html" : extension===".md" || extension===".markdown" ? "text/markdown" : extension===".json" ? "application/json" : "";
  if (!contentType) throw new Error("Only local .html, .htm, .md, .markdown, and .json files are supported");
  const sourceIndex=args.indexOf("--source");
  const source=sourceIndex>=0 ? args[sourceIndex+1] : basename(file);
  if (sourceIndex>=0 && (!source || source.startsWith("--"))) throw new Error("--source requires a value");
  await emitResult(analyzeDocument({source,contentType,content:await readFile(file,"utf8")}),args);
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

async function main() {
  const args=process.argv.slice(2);
  try {
    if (args[0]==="scan") await runScan(args);
    else if (args[0]==="geo") await runGeo(args);
    else { process.stderr.write(usage+"\n"); process.exitCode=2; }
  } catch (error) {
    process.stderr.write("Searqon: "+error.message+"\n");
    process.exitCode=error.message===usage ? 2 : 1;
  }
}
await main();
