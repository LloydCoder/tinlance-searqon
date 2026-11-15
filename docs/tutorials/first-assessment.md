# Tutorial: Run Your First Searqon Assessment

This tutorial runs a local assessment against a repository fixture. It does not make a network request.

## Prerequisites
- Node.js 22 or later.
- Git.

## 1. Get the repository

```bash
git clone https://github.com/LloydCoder/tinlance-searqon.git
cd tinlance-searqon
```

## 2. Run the scanner

```bash
node src/cli.js scan ./examples/site.html
```

Searqon writes a JSON assessment to standard output. The assessment includes separate discipline results, observations and findings with rule identifiers and evidence metadata.

## 3. Save the result

```bash
node src/cli.js scan ./examples/site.html --out ./site-assessment.json
```

The output path must not already exist. Searqon uses exclusive-create semantics to avoid silently overwriting an existing file.

## 4. Render an HTML report

```bash
node src/cli.js report ./site-assessment.json --out ./site-assessment.html
```

Open the generated file in a browser. The report is standalone, loads no remote assets and escapes assessment-supplied text.

## What the result means

The scanner applies a versioned set of partial diagnostics. A finding is a review prompt supported by evidence; it is not a ranking prediction or proof of non-compliance. A result with zero findings does not establish that a property is issue-free.

For supported inputs and rule limitations, read the [Scanner Contract](../SCANNER.md). For other commands, read the [CLI Reference](../reference/cli.md).
