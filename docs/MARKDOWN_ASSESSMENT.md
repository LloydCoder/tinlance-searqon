# Markdown source assessment

Searqon analyzes caller-supplied Markdown as source content. It does not assume that Markdown source is rendered HTML and does not infer browser-computed visibility, crawler behavior, or the metadata emitted by an unknown publishing system.

## Supported front matter subset

The deterministic parser recognizes a deliberately small, non-executing scalar subset of YAML front matter delimited by `---` lines:

- `title`
- `description`
- `canonical`
- `robots`
- `url`
- `lang` and `language`

It accepts plain scalar values and quoted strings. It does not construct YAML objects, resolve aliases, execute tags, or interpret nested collections. Duplicate supported keys, malformed scalar values, unclosed delimiters, and front matter exceeding 16 KiB or 256 lines are reported as rejected metadata. The Markdown body remains available for source-level heading analysis when a closing delimiter is present.

Unknown front matter keys are ignored; this parser is not a general YAML validator. Publishing frameworks may use different metadata names and semantics. Configure an explicit adapter before treating a framework-specific field as canonical.

## Evidence semantics

- A non-empty supported field is reported as present, not as proof that the rendered page emits the corresponding HTML tag.
- An explicitly empty description is a source-level finding.
- An absent description is `not_assessable` when the publishing convention is unknown; Searqon does not call it a missing HTML meta description.
- A source-level `noindex` directive is surfaced for owner review. It may be intentional for private, staging, duplicate, or deliberately excluded content.
- Heading counts and hierarchy are measured from Markdown source outside fenced code blocks and HTML comments. They do not prove final DOM structure or accessibility-tree behavior.
- Browser-computed visibility, rendered canonical tags, rendered language/viewport metadata, structured data emitted by templates, and actual crawler access require rendered-page acquisition and are not inferred from Markdown alone.

Each assessment continues to expose discipline coverage, confidence, scope, and limitations. A partial Markdown source analysis must not be represented as a complete SEO, AEO, GEO, or AgEO audit.
