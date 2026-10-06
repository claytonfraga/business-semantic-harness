# Local SPARQL library selection

Research date: 2026-10-04. Context7 was queried for `/comunica/comunica` and `/oxigraph/oxigraph`, then checked against their first-party documentation and the installed TypeScript API.

No dedicated installed `context7` SKILL.md was found. Research used the available Context7 library resolver and documentation tools, together with the project's research workflow.

## Decision

Use **Comunica SPARQL RDF/JS Lite**, pinned to the already installed `5.4.1`, for the optional, local, read-only general-query adapter. This is a fit decision for BSH's N3 RDF/JS stores and Node/Bun distribution, not a claim that Comunica is faster or more standards-complete than Oxigraph. No comparative performance experiment has been conducted.

The [official Comunica Lite README](https://github.com/comunica/comunica/blob/master/engines/query-sparql-rdfjs-lite/README.md) documents direct RDF/JS sources and streaming SELECT bindings. The [engine variants](https://github.com/comunica/comunica) identify Lite as the small-bundle engine for in-memory RDF/JS sources. This avoids introducing a second RDF representation or a native/WASM distribution requirement. BSH's existing `shacl-engine` dependency already uses this engine; this change makes the dependency explicit and leaves SHACL-SPARQL validation intact.

[Oxigraph's official JavaScript README](https://github.com/oxigraph/oxigraph/blob/main/js/README.md) documents SPARQL 1.1 Query and Update, an in-memory RDF/JS-compatible store, Node.js 18+, and a likely need for a WebAssembly-compatible bundler. Oxigraph is a credible alternative for a dedicated store or measured performance requirement. Adopting it here would require separately verifying WASM packaging and Bun distribution, without an observed requirement that justifies that additional integration.

## Verified API and adapter boundary

[Comunica application documentation](https://comunica.dev/docs/query/getting_started/query_app/) and [bindings documentation](https://comunica.dev/docs/query/advanced/bindings/) explain query streams. The installed `QueryEngineBase.d.ts` exposes `queryBindings` and `queryBoolean`. Context7 also returned a `queryAsk` example; that method is not present in the installed API, so production uses `queryBoolean`.

BSH exposes SELECT and ASK over a supplied immutable local graph snapshot. Joins, FILTER and property paths are tested against the real engine. Parser AST inspection rejects updates, CONSTRUCT/DESCRIBE, SERVICE, and FROM dataset clauses before engine execution; GRAPH can address named graphs already in the snapshot. No source URL, custom function or caller-provided engine context is accepted. There is no RDFS/OWL entailment: queries evaluate explicit snapshot triples.

The adapter returns SUCCESS, EMPTY, ERROR, TIMEOUT, or LIMIT_EXCEEDED and records the query, graph content identity, bounds, RDF term bindings and duration. ASK false is a successful query with a false answer, never automatic gate approval. Empty results, errors and timeouts cannot authorize promotion. A terminated worker enforces the wall-clock bound, including synchronous parsing and engine execution; startup is included in reported query cost. Result limits return incomplete results with an explicit LIMIT_EXCEEDED outcome.

This optional general-query adapter is distinct from the existing structured shape selection and SHACL-SPARQL constraint execution. Querying a graph does not validate candidate facts, prove completeness, select authorization policy, or apply inference. Experiments must compare identical graph facts and separately record agent-context selection and authorization-evidence selection.

## Evidence limits

Context7 and first-party documentation support API and packaging characteristics, not comparative throughput, correctness of every SPARQL feature, or suitability for every domain. Unit/integration tests cover the declared subset; no live agent experiment or E2E is generated or executed for this work. Any benefit attributed to general SPARQL must come from paired experiment records, including failures and cost, rather than library choice alone.
