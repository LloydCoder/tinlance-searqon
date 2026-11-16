# CLI Reference

Run commands from the repository root with Node.js 22 or later:

```bash
node src/cli.js <command>
```

## Commands

| Command | Purpose |
|---|---|
| `scan <local-file>` | Analyze local HTML, Markdown or JSON input |
| `scan-url <public-url>` | Scan one explicitly authorized public page |
| `geo analyze <observation.json>` | Normalize and analyze one supplied GEO observation |
| `geo aggregate <observations.json>` | Aggregate an array of supplied GEO observations |
| `report <assessment.json>` | Render an assessment JSON file as standalone HTML |

## Local scan options

```bash
node src/cli.js scan ./examples/site.html [--source <label>] [--out <json-file>]
node src/cli.js scan ./examples/mcp-snapshot.json --format mcp
```

- `--source <label>`: source metadata; defaults to the input filename.
- `--format mcp`: analyze a local JSON MCP snapshot. It does not connect to an MCP server.
- `--out <json-file>`: write JSON to a new file. If omitted, write to stdout.

Supported extensions: `.html`, `.htm`, `.md`, `.markdown` and `.json`. The input limit is 2 MiB.

## Remote scan options

```bash
node src/cli.js scan-url https://example.com/docs \
  --confirm-authorized-target \
  [--allow-redirect-origin https://approved.example] \
  [--user-agent <token>] \
  [--out <json-file>]
```

- `--confirm-authorized-target`: required operator authorization attestation.
- `--allow-redirect-origin <origin>`: explicitly authorize a cross-origin redirect destination; repeatable.
- `--user-agent <token>`: set the product user-agent token.
- `--out <json-file>`: write JSON to a new file.

Only the selected page is retrieved. Redirect destinations are revalidated. This is not a recursive crawler.

## GEO options

```bash
node src/cli.js geo analyze ./examples/geo-observation.json
node src/cli.js geo aggregate ./examples/geo-observations.json
```

GEO commands accept local JSON only. They do not contact providers or fetch citations.

## HTML report options

```bash
node src/cli.js report ./assessment.json --out ./assessment.html
```

Omit `--out` to write HTML to stdout. File output refuses to overwrite an existing file.

## Configuration

There is no repository-level configuration file or required environment variable at this stage. The current options are command-line flags and API-level parameters documented in the relevant module and schema contracts.


## GEO registry and sampling commands

- `searqon geo registry <registry-input.json> [--out <json-file>]` normalizes a Brand Truth Registry.
- `searqon geo cohort <cohort-input.json> [--out <json-file>]` creates a deterministic locale/market prompt cohort from a normalized registry.
- `searqon geo plan <sampling-input.json> [--out <json-file>]` builds a policy-reviewed, sample-capped and cost-bounded plan; it does not execute collection.
- `searqon geo analyze` and `searqon geo aggregate` continue to analyze supplied observations only.

See [Create a governed GEO sampling plan](../how-to/create-geo-sampling-plan.md) for input contracts and safety boundaries.
