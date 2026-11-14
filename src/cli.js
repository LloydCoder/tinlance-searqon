#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { analyzeDocument } from "./analyzer.js";

const usage = "Usage: searqon scan <local-file> [--source <label>] [--out <json-file>]";
const args = process.argv.slice(2);
if (args[0] !== "scan" || !args[1]) {
  process.stderr.write(usage + "\n");
  process.exitCode = 2;
} else {
  try {
    const file = resolve(args[1]);
    const extension = extname(file).toLowerCase();
    const contentType = extension === ".html" || extension === ".htm" ? "text/html" : extension === ".md" || extension === ".markdown" ? "text/markdown" : extension === ".json" ? "application/json" : "";
    if (!contentType) throw new Error("Only local .html, .htm, .md, .markdown, and .json files are supported");
    const sourceIndex = args.indexOf("--source");
    const outIndex = args.indexOf("--out");
    const source = sourceIndex >= 0 ? args[sourceIndex + 1] : basename(file);
    if (sourceIndex >= 0 && (!source || source.startsWith("--"))) throw new Error("--source requires a value");
    if (outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith("--"))) throw new Error("--out requires a path");
    const result = analyzeDocument({source,contentType,content:await readFile(file,"utf8")});
    const output = JSON.stringify(result,null,2) + "\n";
    if (outIndex >= 0) await writeFile(resolve(args[outIndex + 1]),output,{flag:"wx"});
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write("Searqon: " + error.message + "\n");
    process.exitCode = 1;
  }
}
