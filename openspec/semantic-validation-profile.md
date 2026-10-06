# Semantic validation contract

The promotion guarantee is conditional on the applicable project contracts,
recognized operations, independent extractor coverage and evidence, executed
SHACL/policy checks and technical gates. It is not a universal guarantee that
generated code satisfies unrepresented real-world invariants. Dispatch, tools
and promotion use independent authorization decisions.

Extraction resolves the operation's explicit domain and its declared dependency
closure using sovereign base IRIs, independent of manifest order. Local names
bind to their declaring owner; full IRIs remain intact. Missing or ambiguous
identities stop evaluation without conformance. The built-in JavaScript/TypeScript
adapter uses bounded lexical literal/invocation heuristics, not a full AST or
runtime data-flow verifier. Rule facts identify properties to extract; configured
values are not candidate evidence. A unique source literal is required; absent
or ambiguous values are indeterminate. Lexical findings remain structural
evidence and do not replace behavioral traces. Only exercised adapters and
actually covered paths are recorded.

Requirements: `BSH-ONT-008`, `BSH-ONT-PROFILE-001`, `BSH-ONT-EXECUTION-001` in
`specs/ontology-validation-and-query.feature`. The feature remains authoritative.

Operation selection matches the recognized operation IRI to explicit
`sh:targetClass` declarations. It does not perform general target discovery,
class inference, or competency queries. These selection limits do not reduce
the SHACL engine's target capabilities.

The production `shacl-engine` validator executes SHACL Core and SHACL-SPARQL.
Its target resolution includes class, node, subjects-of, objects-of and
configured SPARQL targets. Core validation supports property paths, logical
alternatives and nested node/property/qualified constraints. Validation retains
SPARQL source-constraint identifiers. A SHACL-SPARQL SELECT with no violation
rows is successful execution of that constraint; it is not proof of general
candidate completeness. Invalid queries throw and the governance boundary
reports validation error. The governance deadline bounds validation; a timeout
cannot authorize promotion. This validation interface provides no general SPARQL query API.
The separate `executeLocalSparql` module supports read-only SELECT/ASK over explicit
local RDF snapshots with joins, FILTER and property paths. It applies no RDF/OWL
inference and returns typed results with distinct empty, error, timeout and result-limit
outcomes. ASK false remains a query answer. Neither successful execution nor any answer
authorizes promotion. SERVICE, remote dataset sources and updates are rejected. Worker
termination enforces the wall-clock bound. See `docs/sparql-library-selection.md`.

No RDF/OWL entailment regime or ontology materialization runs before validation.
The engine resolves `rdfs:subClassOf` relationships present in the shapes graph
for its class matching. It does not establish a general RDFS or OWL closure of
the candidate or import ontology axioms into the candidate. Missing statements
are not synthesized as false values.

The preliminary completeness check covers immediate property shapes with a
named-IRI `sh:path` and positive `sh:minCount`. Every candidate subject explicitly
typed as the recognized operation must contain each such property. Missing
required properties or explicitly indeterminate required facts produce an
indeterminate operation. Presence alone is insufficient: independent candidate
extraction must attest the exact candidate commit and cover all relevant changed
paths, satisfy required evidence gates, and pass SHACL plus technical gates.
Static operation-rule facts cannot replace that candidate representation.

Complex paths, logical alternatives and nested required properties are checked
by SHACL, rather than flattened into fictitious named properties. The preliminary
checker does not claim a general completeness proof for them. The extractor's
coverage and evidence contract remains necessary; SHACL conformity alone cannot
prove that every relevant real-world fact was represented.

`selectedShapes` reports operation selection. `executedShapes` records declared
or targeted shapes whose real root invocation or nested constraint evaluation
produced execution evidence. Each engine root resolves its own actual targets;
a property shared by roots cannot fabricate execution of an absent or
deactivated root. `executionEvidence` retains the source shape, invoking root,
target declarations, focus node, constraint component, SPARQL source constraint
and passed/violation outcome from engine debug/detail results.

Top-level `validationResults` contains actual report violations with structured
source shape and component identifiers. Failed alternatives inside a successful
logical constraint remain execution evidence, not independent top-level
violations. Repeated human-readable messages cannot change shape attribution.
No exercised constraint means `validationExecuted` and `validationComplete`
remain false, even when the raw engine reports vacuous conformity. Every selected
shape must have actual execution evidence before the operation is complete.
