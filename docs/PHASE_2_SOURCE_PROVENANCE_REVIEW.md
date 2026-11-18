# Phase 2 — Source-provenance inventory

**Audit commit:** `dd75a590ae6962bdfdb8df49c0721d3d5b379aed`  
**Audit date:** 2026-11-18  
**Review status:** PARTIAL — repository inventory completed; owner declaration and line-level review remain open.

## 1. Scope and method

This review records repository-level provenance indicators available through the Git tree, commit history, package metadata and project-owner-supplied Searqon brand materials. It is deliberately not a legal opinion, code-similarity report, copyright clearance, or independent verification of the human identity behind Git commits.

## 2. Repository inventory

| Check | Observation | Interpretation |
|---|---|---|
| Recursive Git tree | 349 tracked blobs | Inventory baseline at the audited commit |
| Git submodules | No `.gitmodules` file | No registered submodules found |
| Vendored source | No path matching vendor/third-party directories | No obvious vendored source tree found |
| Minified bundles/source maps | No `.min.js`, `.min.css` or source-map files found | No obvious compiled third-party bundle in the tracked tree |
| `NOTICE` file | Absent | No separate project NOTICE file is currently distributed |
| Commit history | 164 commits across two result pages; page 3 empty | All 164 report GitHub author login `LloydCoder`; this is metadata, not proof of authorship/originality |
| Root license | Apache License 2.0 | Declared project license; does not itself prove every file is first-party or clear trademark rights |
| Runtime dependencies | 14 non-root locked packages | Every lockfile entry has MIT or ISC metadata; direct dependency is `pg@8.23.1` (MIT) |

The 14-package license inventory is reproduced in [PHASE_2_OPEN_SOURCE_FOUNDATION.md](PHASE_2_OPEN_SOURCE_FOUNDATION.md). Dependencies are installed from npm and are not vendored in the tracked source tree.

## 3. Brand assets and supplied provenance

The project-owner-supplied Searqon Brand Kit v1.0 Draft and Brand Usage Guide dated 2026-11-14 were inspected:

- The brand-kit README states “Built by Tinlance.”
- The usage guide identifies the logo as a “custom drawing by Claude.”
- The guide explicitly says the Searqon name and logo have not been cleared for trademark or domain use.
- The kit contains Instrument Sans and DM Mono font binaries with SIL Open Font License 1.1 license texts. The audited repository tree contains no font binaries; the supplied font licenses therefore do not represent bundled repository dependencies.
- The repository contains four SVG brand-related assets. Their presence and style are consistent with the brand kit, but this audit did not perform a byte-for-byte comparison of every repository SVG with the corresponding supplied-kit asset.

The guide is project-supplied evidence of the stated design process. The exact Claude service/account/plan terms accepted when the logo was generated have not been established here. No legal conclusion is made about the protectability of AI-generated output, copyright ownership, trademark clearance, or domain rights. The owner should retain the original design prompt, generated source/output, account/plan details and any subsequent designer assignment or refinement agreement.

## 4. Findings and limits

1. No obvious vendored source, submodule, minified bundle or source map was identified in the tracked tree.
2. The package dependency graph has license metadata for all 14 locked non-root packages; the observed SPDX license set is MIT and ISC.
3. Git history consistently attributes commits to one GitHub login. That does not prove the account holder personally authored every line or that no code was adapted from external sources.
4. A full line-by-line review of all JavaScript, HTML, CSS, SQL, JSON and SVG files, source-similarity analysis, and verification of any externally sourced snippets have not been completed.
5. The supplied brand guide records that trademark/domain clearance remains outstanding. This is a separate brand/legal issue and is not represented as cleared by the Apache-2.0 code license.

## 5. Required owner declaration

Before Phase 2 can pass its source-provenance gate, the repository owner must complete [OWNER_SOURCE_PROVENANCE_ATTESTATION_TEMPLATE.md](OWNER_SOURCE_PROVENANCE_ATTESTATION_TEMPLATE.md), identify exceptions and provide evidence or upstream license references for any third-party/adapted material. Do not sign or infer the owner's declaration on their behalf.

## 6. External references

- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [GitHub repository rulesets and required permissions](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10)
- [SLSA build provenance specification](https://slsa.dev/spec/v1.2/build-provenance)
- [SLSA artifact verification guidance](https://slsa.dev/spec/v1.2/verifying-artifacts)
- [Anthropic Legal Center](https://www.anthropic.com/legal) — applicable output terms depend on the service and account terms in force when the logo was generated; this review does not assume a particular contract applies.

