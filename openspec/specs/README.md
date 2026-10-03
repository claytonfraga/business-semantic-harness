# BSH requirement catalog

Extracted on 2026-10-03 from the current working tree, including existing local TUI and palette edits.

The behavioral requirements are written in Portuguese Gherkin (`# language: pt`), following the existing slash-command palette and journey specifications. Supporting documentation and metadata are in English. This catalog contains 312 identified scenarios in 23 capability files. Scenarios may contain several related acceptance criteria; the scenario count is not a count of atomic obligations.

## Specification authority

The `.feature` files in this directory are the authoritative behavioral requirements. Update the relevant feature before implementing a changed requirement. Code, tests, Markdown designs, and historical proposals cannot override feature acceptance criteria. Journey features define execution plans derived from these requirements.

[opentui-component-tui.feature](opentui-component-tui.feature) records the permanent OpenTUI component rule and behavior-preserving migration contract. The architectural design is in [rebuild-tui-with-opentui](../changes/rebuild-tui-with-opentui/design.md). The original extraction baseline is commit `2afc270`; architecture rules were added on `feature/opentui-component-tui-rewrite`. This preparation does not claim that the TUI rewrite has been implemented.

## Inviolable Architectural Requirement: Domain Agnosticism & Project Sovereignty (Regra de Ouro)

BSH is strictly an ontology-agnostic semantic harness engine.
1. **Decoupling**: The BSH core package, CLI, TUI, and runtime engine **SHALL NOT** be coupled to any specific domain ontology (such as `ativos`, `saude`, `financeiro`, `telecom`, etc.).
2. **Project Residency**: Every domain ontology belongs sovereignly and exclusively to its respective project, residing in `<project>/.bsh/domains/<domain>/` (`ontology.jsonld` and `shapes.ttl`).
3. **No Global/Package Leakage**: Domain ontologies SHALL NEVER be bundled into the BSH distribution package, moved to global directories, or statically baked into the engine.
4. **Dynamic Extensibility**: If a user implements any new domain ontology, it is introduced by creating its directory inside the project's `.bsh/domains/` folder. BSH discovers, validates, and enforces it dynamically at runtime. (See `@BSH-DIST-013` and `@BSH-ONT-012`).

## Reading the catalog

Each scenario has a stable `@BSH-<CAPABILITY>-<NUMBER>` identifier. Source comments at the top of each feature identify the code, tests, specification changes, or journeys used for extraction. [requirements-index.json](requirements-index.json) records scenario locations, source references, all 15 journey mappings, and hashes of the source inventory.

Untagged scenarios describe an extracted contract supported by code, tests, or repository policy; they are not a claim that the complete user journey passed. `@specified` marks an explicit acceptance obligation. `@gap` marks a known mismatch or incomplete implementation. `@historical` marks an older obligation that conflicts with newer behavior and needs reconciliation rather than silently replacing the current contract. See [review-notes.md](review-notes.md) for the concrete differences.

Requirements for capability behavior live here; journey execution plans remain in `test/features/journeys/`. The catalog consolidates journey obligations into capability scenarios rather than copying the same journey prose into a second source of truth. Journey mapping is at capability level, not a claim of step-by-step automated coverage. Historical change proposals and task lists remain preserved under `openspec/changes/`.

## Capability files

| Feature | Scenarios |
| --- | ---: |
| [action-approval-and-audit.feature](action-approval-and-audit.feature) | 11 |
| [asset-management-pilot.feature](asset-management-pilot.feature) | 33 |
| [authentication-and-configuration.feature](authentication-and-configuration.feature) | 15 |
| [autonomous-agent-and-headless.feature](autonomous-agent-and-headless.feature) | 14 |
| [cli-and-project.feature](cli-and-project.feature) | 13 |
| [distribution-and-engineering-policy.feature](distribution-and-engineering-policy.feature) | 12 |
| [domain-affinity.feature](domain-affinity.feature) | 7 |
| [evaluation-and-evidence.feature](evaluation-and-evidence.feature) | 14 |
| [git-session-isolation-and-recovery.feature](git-session-isolation-and-recovery.feature) | 18 |
| [historical-adapter-and-auth-domain.feature](historical-adapter-and-auth-domain.feature) | 11 |
| [mcp-client-and-external-tools.feature](mcp-client-and-external-tools.feature) | 10 |
| [mcp-server-and-proposals.feature](mcp-server-and-proposals.feature) | 12 |
| [menu-de-comandos-barra.feature](menu-de-comandos-barra.feature) | 11 |
| [model-and-domain-selection.feature](model-and-domain-selection.feature) | 9 |
| [ontology-validation-and-query.feature](ontology-validation-and-query.feature) | 11 |
| [opentui-component-tui.feature](opentui-component-tui.feature) | 16 |
| [openrouter-client.feature](openrouter-client.feature) | 7 |
| [prompt-guard-and-governance-mode.feature](prompt-guard-and-governance-mode.feature) | 11 |
| [semantic-enforcement-and-promotion-gate.feature](semantic-enforcement-and-promotion-gate.feature) | 21 |
| [skills-installation-and-runtime.feature](skills-installation-and-runtime.feature) | 13 |
| [tui-input-history-and-navigation.feature](tui-input-history-and-navigation.feature) | 18 |
| [tui-layout-and-feedback.feature](tui-layout-and-feedback.feature) | 13 |
| [workspace-tools.feature](workspace-tools.feature) | 12 |

## Existing journey coverage

| Journey | Capability identifiers | Existing plan |
| --- | --- | --- |
| 01 | GUARD, SEM, GIT | [jornada-01-governado-bloqueio.feature](../../test/features/journeys/jornada-01-governado-bloqueio.feature) |
| 02 | GUARD, TUI | [jornada-02-desgovernado-sem-harness.feature](../../test/features/journeys/jornada-02-desgovernado-sem-harness.feature) |
| 03 | SEM, AGENT, GIT | [jornada-03-governado-conforme.feature](../../test/features/journeys/jornada-03-governado-conforme.feature) |
| 04 | AFF | [jornada-04-desalinhamento-afinidade.feature](../../test/features/journeys/jornada-04-desalinhamento-afinidade.feature) |
| 05 | SELECT, OR | [jornada-05-busca-e-troca-modelos.feature](../../test/features/journeys/jornada-05-busca-e-troca-modelos.feature) |
| 06 | MCPS | [jornada-06-mcp-servidor-governanca.feature](../../test/features/journeys/jornada-06-mcp-servidor-governanca.feature) |
| 07 | MCPC | [jornada-07-mcp-cliente-terceiros.feature](../../test/features/journeys/jornada-07-mcp-cliente-terceiros.feature) |
| 08 | INPUT, AGENT, SEM | [jornada-08-rolagem-historico-loop-agente.feature](../../test/features/journeys/jornada-08-rolagem-historico-loop-agente.feature) |
| 09 | AGENT, TOOLS, SEM | [jornada-09-agente-codificacao-autonomo.feature](../../test/features/journeys/jornada-09-agente-codificacao-autonomo.feature) |
| 10 | GUARD, INPUT | [jornada-10-guarda-semantica-negacoes-e-linha-unica.feature](../../test/features/journeys/jornada-10-guarda-semantica-negacoes-e-linha-unica.feature) |
| 11 | INPUT, TUI | [jornada-11-ergonomia-tui-fila-e-atalhos.feature](../../test/features/journeys/jornada-11-ergonomia-tui-fila-e-atalhos.feature) |
| 12 | TUI, INPUT, SELECT | [jornada-12-ux-avancada-raciocinio-diff-multilinha-fuzzy.feature](../../test/features/journeys/jornada-12-ux-avancada-raciocinio-diff-multilinha-fuzzy.feature) |
| 13 | SKILL, TOOLS, SEM | [jornada-13-mecanismo-de-skills-e-prototipacao.feature](../../test/features/journeys/jornada-13-mecanismo-de-skills-e-prototipacao.feature) |
| 14 | SKILL, TOOLS | [jornada-14-instalacao-e-inclusao-dinamica-de-skills.feature](../../test/features/journeys/jornada-14-instalacao-e-inclusao-dinamica-de-skills.feature) |
| 15 | MENU, INPUT | [jornada-15-menu-de-comandos-barra.feature](../../test/features/journeys/jornada-15-menu-de-comandos-barra.feature) |
| 16 | OPENTUI, MENU, INPUT, TUI | [jornada-16-reconstrucao-opentui.feature](../../test/features/journeys/jornada-16-reconstrucao-opentui.feature) |

All journeys also depend on the `EVAL` evidence policy. Journey 6 describes external Agy integration over MCP; the Codex functional-session policy remains a separate adapter obligation. The native CLI currently has no `codex` subcommand.

## Scope and limits

The review covers the first-party TypeScript product modules, pilot HTTP/domain code and local ontology, test contracts and journey plans, OpenSpec proposals/specifications/tasks, packaging, CI/release configuration, and evaluation utilities. Generated output (`dist`), installed dependencies (`node_modules`), tarballs, binary recordings, historical execution logs, and third-party skill bodies are not independent product requirement sources. Domain data instances are examples of facts, not hundreds of additional product features. The pilot ontology remains in its owning project; this catalog records its rules without copying the ontology.

Completed task checkboxes and passing-looking historical reports are not used as proof of current behavior. Where sources disagree, the current contract and the historical obligation are distinguished in Gherkin and in review notes. No runtime code, ontology, journey plan, or automated test implementation was changed by this extraction. The existing palette criteria were preserved, scenario identifiers were added, two mixed-language step keywords were normalized to `E`, and five complementary scenarios were extracted from the selector behavior.

## Validation

Gherkin syntax is checked with the official Cucumber parser. Identifier uniqueness, source existence, index references, journey references, and first-party source inventory coverage are checked locally. This is documentation validation; it does not execute the scenarios, prove business conformance, or approve an E2E run. See [validation.json](validation.json) for the recorded result.
