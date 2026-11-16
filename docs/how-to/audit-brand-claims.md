# Audit brand claims and citations

Searqon can compare supplied answer claims with a versioned Brand Truth Registry. The analyzer is deterministic and evidence-relative. It does not prove that a claim is universally true and does not call an LLM or fetch citation URLs.

## Run the CLI

~~~bash
node src/cli.js claims audit examples/claim-defense-input.json --out claim-defense-report.json
~~~

The input contains:
- a normalized Brand Truth Registry;
- an observation timestamp;
- structured claims with an optional attribute/value annotation;
- optional citation URLs and competitor domains.

If structured claims are not supplied, the analyzer can extract sentences that mention the brand or a registered alias from answerText. This extraction is sentence segmentation plus entity-term matching; it is not semantic claim extraction. For higher precision, supply claim-level attribute/value annotations from a reviewed extraction process.

## Assessment model

Each claim receives one of these classifications:
- registry_consistent: the claim value matches a current registry fact;
- potential_contradiction: a supplied attribute maps to a registry fact but the claimed value differs;
- unverified: no registry fact supports the supplied claim;
- disputed: the matching registry fact is marked disputed;
- stale: the fact is retired, older than maxAgeDays, or dated after the observation.

Citation assessment is separate:
- matched_registry_source;
- citation_unverified;
- attribution_swap when a cited domain is in the supplied competitor-domain set and is not a registry source;
- missing_citation.

Confidence reflects registry provenance only: corroborated facts with multiple sources are high, corroborated or sourced owner assertions are medium, unsourced owner assertions are low, and unmatched claims are none. This is not a calibrated probability of truth.

## Correction manifest

The report emits a correction manifest for contradictions, unverified/stale/disputed facts and citation issues. It may propose the registry statement and its source URLs when the registry fact is current and usable.

Every correction item requires human approval. The schema fixes autoPublish to false. The analyzer never edits a website, publishes content, opens a pull request or changes a provider response.

## Limitations

- No source URL is fetched or independently verified.
- Registry status is operator-supplied provenance, not a guarantee of factual accuracy.
- Sentence extraction does not resolve pronouns, multi-sentence claims, negation, temporal qualifiers, numeric ranges or complex attribution.
- Exact attribute/value matching can produce false positives and false negatives; use a labeled evaluation set before production use.
- Competitor attribution is domain-based and only as accurate as the supplied competitor-domain list.
- Freshness is measured from reviewedAt or assertedAt using maxAgeDays; it is not a domain-specific freshness model.
- The report is evidence for human review, not a universal hallucination score.
