# How to Analyze GEO Observations

The GEO CLI works with observations supplied by the caller. It does not collect answers from AI providers or scrape consumer interfaces.

## Analyze one observation

```bash
node src/cli.js geo analyze ./examples/geo-observation.json
```

## Aggregate a set of observations

```bash
node src/cli.js geo aggregate ./examples/geo-observations.json
```

Aggregation groups observations by explicit provider and observation dimensions. Consumer-facing observations and direct model API observations are kept separate. Mention and citation rates include Wilson 95% confidence intervals; small sample sizes still require cautious interpretation.

## Important interpretation limits

- The repository examples are synthetic fixtures, not live provider measurements.
- Citation URLs are normalized but are not fetched.
- No scheduler, historical database or monitoring service is included.
- Raw prompt and answer text are not returned in normalized records.
- The aggregator validates recorded digest metadata but cannot recompute a digest without the original payload.

See the [GEO observation schema](../../schemas/geo-observation.schema.json) and [Scanner Contract](../SCANNER.md) for the data contract.
