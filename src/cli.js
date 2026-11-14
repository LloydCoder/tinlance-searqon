#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeDocument } from "./analyzer.js";

const usage = "Usage: searqon scan <local-file> [--source <label>] [--out <json-file>]";
const args = process.argv.slice(2);
if (args[0] !== "scan" || !args[1]) {
  process.stderr.write(usage + "\\n");
  process.exitCode = 2;
} else {
  try {
    const file = resolve(args[1]);
    const extension = extname(file).toLowerCase();
    const contentType = extension === ".html" || extension === ".htm"
      ? "text/html"
      : extension === ".json" ? "application/json" : "";
    if (!contentType) throw new Error("Only local .html, .htm, and .json files are supported");
    const sourceIndex = args.indexOf("--source");
    const outIndex = args.indexOf("--out");
    const source = sourceIndex >= 0 ? args[sourceIndex + 1] : file;
    if (sourceIndex >= 0 && (!source || source.startsWith("--"))) throw new Error("--source requires a value");
    const result = analyzeDocument({ source, contentType, content: await readFile(file, "utf8") });
    const output = JSON.stringify(result, null, 2) + "\\n";
    if (outIndex >= 0) {
      const outputPath = args[outIndex + 1];
      if (!outputPath || outputPath.startsWith("--")) throw new Error("--out requires a path");
      await import("node:fs/promises").then(fs => fs.writeFile(resolve(outputPath), output, { flag:"wx" }));
    } else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`Searqon: ${error.message}\\n`);
    process.exitCode = 1;
  }
}
