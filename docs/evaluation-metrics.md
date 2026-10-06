# Operational evaluation metrics

The authoritative requirements are in `openspec/specs/experimental-evaluation.feature`.
This evaluation concerns the existing architecture; token savings and fewer promotions
cannot establish adequacy by themselves.

A false block requires an existing candidate, a `VALID` independent oracle verdict,
and a recorded `DENY` promotion decision. A validation violation alone does not establish
a false block. A promoted violation requires an `INVALID` independent oracle verdict
and evidence that the candidate was actually promoted. An allowed decision without
integration does not count as promotion.

No candidate, refusal, technical failure, missing evidence, timeout, and error are
distinct outcomes. Indeterminate oracle or authorization results remain indeterminate.
Rule coverage measures evaluated run-rule instances against the declared expected
instances; evidence coverage uses the same per-run denominator for evidence identifiers.
Unique identifier coverage is a separate descriptive measure, so evaluation in one
trial cannot cover a missing evaluation in another trial.
No denominator means unavailable coverage, rather than complete coverage.

Explanation assessment compares structured claims against decision records and their
verifiable references. References must resolve to content preserved with a matching
SHA-256, or a stored query result pinned to such content. A listed reference alone
does not establish recoverability. A convincing interface message is not evidence. Unsupported
claims and missing decision references remain visible separately.

Record review time and human work separately. Costs identify generation, query,
extraction, validation, technical gates, review, preparation, and maintenance, and
classify each entry as deployment or recurring. Amounts in different currencies are
never silently added together. Missing measurements remain unavailable. Cost per
accepted and validated change uses candidates with an allowed decision, actual
promotion, and completed validation; zero such candidates gives no unit-cost estimate.
Deployment cost, recurring cost, and their measurement coverage remain separate.
Each run declares applicable phases through `expectedCostPhases`; undeclared applicability
or a missing declared phase leaves complete totals unavailable while preserving measured
subtotals. Nonapplicable generation in a fixed-candidate trial is never invented.

`scripts/gate-exposure.mjs` evaluates fixed validation candidates with the production
validator. It does not integrate commits, so false-block and promoted-violation
metrics are unavailable for that track. Validation false positives and false negatives
are reported using their own names instead.

Invoke exposure as `node scripts/gate-exposure.mjs <project> [output] [domain] [candidate-manifest]`.
The selected domain comes from the project's manifest; multi-domain projects require
an explicit selection. The default candidate manifest is
`evaluation/fixtures/candidates.json`, with entries `{id, expected, path}` and
project-relative paths. This is a validation module integration track, not a full
agent, CLI, or TUI E2E execution.
