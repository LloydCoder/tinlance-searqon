# Create a governed GEO sampling plan

This workflow creates a versioned Brand Truth Registry, a deterministic prompt cohort, and a cost-bounded plan. It does not call a provider, scrape a consumer interface, or execute a collection task.

## 1. Create the Brand Truth Registry

Create a local JSON input file:

~~~json
{
  "brandName": "Example Brand",
  "primaryDomain": "example.com",
  "aliases": ["Example"],
  "assertedBy": "workspace-owner-id",
  "createdAt": "2026-11-16T12:00:00.000Z",
  "facts": [
    {
      "attribute": "product.category",
      "value": "Developer observability platform",
      "statement": "Example Brand is a developer observability platform.",
      "status": "owner_asserted",
      "sourceUrls": ["https://example.com/about"]
    }
  ]
}
~~~

Normalize and validate it:

~~~bash
node src/cli.js geo registry brand-input.json --out brand-truth-registry.json
~~~

Facts are explicitly classified as owner_asserted, corroborated, disputed, or retired. A corroborated or disputed fact requires a reviewer, review timestamp and at least one HTTPS source. This is provenance metadata, not an independent guarantee that the claim is true. The registry digest detects accidental edits or content changes that do not also replace the digest. It is a checksum, not a signature or authenticity guarantee; anchor it in a separately trusted evidence record if tamper evidence is required.

## 2. Define a prompt cohort

Create a JSON input referencing the normalized registry:

~~~json
{
  "registry": { "...": "contents of brand-truth-registry.json" },
  "locale": "en-CA",
  "market": "CA",
  "createdAt": "2026-11-16T12:00:00.000Z",
  "prompts": [
    {
      "prompt": "Which developer observability platforms are suitable for mid-market teams?",
      "intent": "commercial",
      "journeyStage": "consideration"
    },
    {
      "prompt": "How do engineering teams compare observability platforms?",
      "intent": "informational",
      "journeyStage": "awareness"
    }
  ]
}
~~~

Run:

~~~bash
node src/cli.js geo cohort cohort-input.json --out prompt-cohort.json
~~~

Prompts are normalized for deterministic IDs and equivalent prompt/intent/stage combinations are deduplicated. Locale and market are explicit cohort dimensions; do not combine materially different locales into one sample group.

## 3. Build the sampling plan

Each provider entry must contain an approved policy review and an explicit sample-cost estimate. Example provider entry:

~~~json
{
  "name": "Consumer answer interface",
  "observationClass": "consumer_observation",
  "collectionMode": "manual_capture",
  "policyReview": {
    "status": "approved",
    "reviewedAt": "2026-11-16T11:00:00.000Z",
    "reviewerId": "policy-reviewer-id",
    "sourceUrl": "https://provider.example.com/terms"
  },
  "estimatedCostPerSampleUsd": 0,
  "maxSamples": 20
}
~~~

For a model API, use observationClass "model_api", collectionMode "official_api" and a named adapter identifier. Do not put API keys, tokens or credentials in the plan.

Run:

~~~bash
node src/cli.js geo plan sampling-input.json --out sampling-plan.json
~~~

The planner enforces:
- consumer-facing observations are manual capture only; automated UI scraping is rejected;
- model API observations use official API adapters and remain a separate observation class;
- each provider's terms/policy review is approved and dated before the plan is created;
- provider sample caps and a global 10,000-task ceiling;
- an explicit USD cost cap and a calculated estimated cost that must remain within it;
- deterministic task and plan identifiers.

## 4. Execute and analyze observations

The sampling plan is a preflight artifact only. It does not execute adapters. Collect observations only through separately approved, terms-compliant workflows and preserve the observation class, provider/model, region, locale, timestamp, prompt and evidence provenance. Analyze each supplied observation with:

~~~bash
node src/cli.js geo analyze observation.json --out observation-result.json
node src/cli.js geo aggregate observations.json --out aggregate.json
~~~

Never pool consumer_observation and model_api rates. The aggregator retains provider/model/region/locale cohort boundaries and confidence intervals.

## Limits

- No live provider adapters, consumer-interface scraping, scheduler, durable GEO history or monitoring is enabled by these commands.
- A registry fact can be owner-attested without being externally verified.
- A provider policy review is an operator record, not legal advice or proof of provider approval.
- A sampling plan is not authorization to exceed provider terms or the configured budget.
