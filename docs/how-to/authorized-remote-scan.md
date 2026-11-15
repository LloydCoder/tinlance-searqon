# How to Scan One Authorized Public URL

Use this procedure only for a public URL you own or are explicitly authorized to assess.

## Run a bounded scan

```bash
node src/cli.js scan-url https://example.com/docs --confirm-authorized-target
```

The confirmation flag is an operator attestation. It does not independently verify ownership or legal authority.

## Authorize a cross-origin redirect

Cross-origin redirects are denied by default. If the selected page redirects to a separately authorized origin, list that exact origin:

```bash
node src/cli.js scan-url https://example.com/docs \
  --confirm-authorized-target \
  --allow-redirect-origin https://docs.example.net
```

Repeat `--allow-redirect-origin` for each separately authorized destination origin.

## What the scanner does

- Accepts an HTTP or HTTPS public URL subject to URL and DNS policy.
- Validates DNS answers and pins the validated address for the connection.
- Checks robots policy at the initial URL and redirect destinations.
- Validates redirect hops and denies HTTPS downgrade redirects.
- Bounds redirects, response size and request timing.
- Retrieves only the selected page.

## What it does not do

- Recursively follow links.
- Render browser JavaScript.
- Authenticate, guess credentials or invoke discovered APIs or MCP tools.
- Prove that the operator owns the target.
- Provide a complete SSRF certification or production crawler.

If a request is rejected, review the URL, DNS, redirect and robots policy outcome. Do not bypass a control to force a scan.
