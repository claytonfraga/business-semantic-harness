# Controlled evaluation contract

The requirements in `openspec/specs/experimental-evaluation.feature` govern tasks 30–32. The evaluation API uses the same recognition, evidence extraction, SHACL validation and technical gates as production. It records observations rather than asserting that the architecture is adequate. No live benchmark, model comparison or product superiority is established by these changes.

## Tracks and conditions

`executeControlledRun(seed, stages)` accepts an `ExperimentRun` seed and explicit stage adapters. Fixed candidates bypass `generate` completely. Native generation uses `createNativeGeneration(session, options)` with the real BSH agent loop; each condition needs a fresh, clean isolated Git session at the same base. Model transport can be mocked in module integration tests and must be identified as such. Generation failures retain their observed outcome instead of being counted as false blocks.

Use conditions for text rules, structured ontology context, structured context with enforcement, and alternative policies over identical candidate facts. A local general SPARQL condition is available separately. `createContextSelector` provides these context modes; the production authorization extractor does not receive this selected agent context. `createProductionStages` binds candidate identities to actual Git state and calls the production extractor, validator and gates. Semantic decisions remain recoverable even when the experiment observes them without applying enforcement.

`executeControlledBatch` rejects different controls and duplicate conditions before invoking stages, then checks actual fact/source equivalence after extraction. Its `comparable` flag and diagnostics must accompany any interpretation. By default, general SPARQL reads the same project ontology and shapes as the structured selector. Queries against caller-supplied graphs retain that separate source identity; unequal sources invalidate a query-mechanism contrast.

`assertControlledComparison` rejects different projects, domains, technology, agent/version/model, task prompt, base, budget or technical gates. Fixed candidates must have the same candidate content identity; alternative policies require identical extracted-fact identity. The analysis API repeats these controls before estimating effects. Context mode and policy are the intended experimental treatments. If multiple treatments vary together, an effect cannot be attributed to one alone; use separate paired contrasts.

The native budget declares maximum output tokens **per model request**, maximum agent turns, and a generation deadline. It does not claim a bound on all input tokens. Provider-reported token usage is measured; missing usage remains unavailable. Timeout requests abort generation and the runner records timeout even if a custom adapter ignores cancellation. Custom generators must honor the signal to stop side effects; the runner cannot forcibly terminate arbitrary in-process callbacks. The local SPARQL worker has a separate enforceable termination deadline.

Native generation verifies its declared version against the installed BSH package and binds the unchanged base system prompt through `controls.systemPromptHash`. Experimental context is appended afterward and is the treatment, rather than an unrecorded prompt difference.

`ACCEPTED` means the experimental decision and declared technical gates accepted a candidate. It does not mean a commit was integrated. The runner records `promoted=false`; actual production integration must be measured by a separate authorized promotion procedure. Pure validation exposure in `scripts/gate-exposure.mjs` has no promotion decision and cannot yield observed false blocks or promoted violations.

## Recoverable inputs and consistency

`getProductionIdentity` captures the candidate patch and recoverable base representation. Production evaluation captures manifest, contracts, policies, correspondence bindings, adapter identities/implementation and extracted facts. `executeAndCaptureRun` writes an immutable manifest inside the selected project's `.bsh/local/evaluation/<runId>/`. It verifies content identities and refuses paths escaping that project. No project ontology is installed into BSH or transferred to another project.

`replayExperimentRun` verifies the manifest and calls an evaluator with the recovered structured inputs. It never interprets the final UI message as a decision. The callback must reconstruct the candidate/base and execute the production evaluator when reproducing an operational decision; returning a recorded result alone is not independent revalidation. Snapshot-pinned sources use stored bytes, strict immutable sources refuse drift, and revalidation sources are re-read and evaluated before recording a new result. External readers are supplied explicitly. Hashes establish identity, not certification or authorization.

Production snapshots also capture the approval audit used by the decision. Archived facts and shapes can reproduce SHACL independently of the UI. Full Git-dependent governance reproduction requires the preserved session/commit identities and matching approval records; the archive and patch recover code content but do not synthesize original Git history or human authorization.

`analyzePairedRuns` reports the raw mean paired difference, paired Cohen dz when defined, and a deterministic hierarchical percentile bootstrap interval. Resampling preserves project and task groups and explicit replicate pairs. Incomplete pairs, unequal controls, missing measurements and few project clusters produce diagnostics. Fewer than two independent projects produces no interval. Results remain disaggregated by domain, technology, model, condition and failure stage; exploratory intervals do not establish transfer to unseen projects.

`summarizeTransfer` records reused/adapted artifact identities, adaptation/review/human effort and costs. Unknown effort remains unknown. Knowledge reuse does not configure or authorize the destination project's sovereign domain package.

## Use and evidence

Compose `createProductionStages(session, createContextSelector(...), createNativeGeneration(...))`, execute a fully identified seed, and archive its returned run. Fixed-candidate seeds carry the actual committed candidate and base identities from `getProductionIdentity`. Generation seeds carry the same base and no candidate. The oracle is independent of the harness and its reference/hash must be supplied by the evaluation owner.

Feed archived runs into `summarizeOperationalMetrics` and `analyzePairedRuns`. Declare `expectedCostPhases` for every applicable deployment and recurring phase, including package preparation and maintenance; supply explicit human observations and monetary measurements. Missing phase applicability or measurements prevents a complete cost total. Keep token cost, financial cost, review time, oracle validity and observed promotion outcomes together when assessing adequacy.

Comparisons with other products use `compareGovernedProducts`: the governed object, execution points and supporting evidence must be declared. Unequal scopes prevent a direct superiority claim. The SPARQL adapter is documented in [SPARQL library selection](sparql-library-selection.md), and metric denominators in [Operational metrics](evaluation-metrics.md).

Validation for this change is unit and production-module integration only. No E2E journeys are created or run. Existing SHACL-SPARQL regression tests remain separate from general queries.
