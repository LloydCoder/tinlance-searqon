# Standalone HTML Assessment Reports

The CLI can render a versioned Searqon assessment JSON file as a standalone HTML report:

```bash
node src/cli.js scan ./examples/site.html --out ./site-assessment.json
node src/cli.js report ./site-assessment.json --out ./site-assessment.html
```

Omit `--out` to write the HTML to standard output. File output uses exclusive-create semantics and refuses to overwrite an existing file.

## Report contents

- A summary of finding counts by severity.
- Separate SEO, AEO, GEO, and AgEO assessment status, coverage, confidence, scope, and limitations.
- Evidence-linked findings with rule identifiers and recommendations.
- Evidence provenance metadata, content length, and SHA-256 digest.

The report does not invent a composite discoverability score. A zero-finding assessment is not proof that a system is issue-free; coverage and limitations remain visible.

## Security and privacy

- All report-supplied strings are HTML-escaped before rendering.
- The report includes a restrictive Content Security Policy with a SHA-256 hash for its sole inline stylesheet.
- It loads no remote scripts, fonts, images, stylesheets, or other resources.
- The report command performs no network access and does not upload evidence.
- Source labels and findings are displayed as text, not executable markup or external links.
- Output files are created exclusively; existing files are not overwritten.

The report is a local presentation of the assessment JSON. It does not make evidence immutable, digitally sign the report, or replace independent verification of the evidence record.
