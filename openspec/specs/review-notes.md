# Requirement extraction review notes

Review date: 2026-10-03. These observations describe the working tree reviewed for extraction. They are not runtime test results or implementation changes. Capability scenarios remain the behavioral requirement source; this document explains disagreements between sources.

## Source precedence

The user's language and extraction instructions take precedence over older repository documents. Current repository policies remain requirements even when the native implementation does not support the legacy adapter mentioned by those policies. Implementation behavior is recorded separately from historical design promises. A checked task is not evidence of an implemented or verified contract.

## Differences requiring reconciliation

| Area | Evidence and difference | Catalog reference |
| --- | --- | --- |
| Authentication persistence | The original native specification saves manual keys to project `.env`; the governance feature and README promise ephemeral browser sessions. `src/tui/modals.ts` and `src/cli/authCommand.ts` now persist login credentials to the user store. The PKCE helper itself returns a key without persistence. These are distinct contracts. | `AUTH` |
| Credential precedence | The comment in `src/config/env.ts` says environment, user store, project file. Executable branches choose environment, project file, user store. The extracted current contract follows the branches. | `BSH-AUTH-002` |
| User-store permissions | Directory/file modes supplied to creation do not enforce those modes on pre-existing paths. The catalog scopes the creation guarantee to new paths; audit persistence explicitly uses chmod. | `AUTH`, `DEC` |
| Strict isolation | TUI and headless initialization silently fall back to the project directory if worktree creation fails. This does not satisfy the strict worktree guarantee in the native specification and README. | `BSH-GIT-018` |
| Tool confinement | File tools check lexical paths, not resolved symlink targets. `run_bash_command` sets a working directory but does not provide an OS sandbox. Neither mechanism alone establishes confinement of all writes. | `BSH-TOOLS-009` |
| Model cache | The design specifies 24-hour local/disk caching, while `OpenRouterClient` currently uses a one-hour in-memory cache. | `BSH-OR-003`, `BSH-OR-004` |
| Affinity thresholds | The affinity specification describes two matches as sufficient; the code uses score at least 0.15, or at least five matches and score at least 0.05. | `BSH-AFF-004`, `BSH-AFF-005` |
| Guard generality | `detectPromptViolation` uses asset-specific vocabulary and domain names as pilot defaults. It must transition to generic ontology concept loading. Preventive keyword classification is not a SHACL validation proof. | `GUARD`, `ONT`, `SEM` |
| Domain decoupling (Requisito Pétreo) | BSH is strictly an ontology-agnostic semantic harness engine. No domain ontology may be baked into BSH. All domain ontologies reside sovereignly in `<project>/.bsh/domains/<domain>/`. The engine dynamically resolves, validates, and enforces any project-supplied ontology. | `BSH-DIST-013`, `BSH-ONT-012` |
| Preview versus promotion gate | `evaluateWorkspaceDiffGate` uses optional recognition and limited heuristics. Its rules lookup passes a `regras.json` path to a loader that expects a project root and reads `enforcement.json`; the error is swallowed. `evaluateGovernance` is the independent promotion gate with coverage, candidate facts, and fingerprints. | `SEM` |
| Trusted candidate facts | Native TUI and headless promotion calls do not supply a `CandidateFactsExtractor`. Operations requiring SHACL evidence can therefore remain indeterminate even when the preview reports conforming. | `BSH-SEM-007`, `BSH-SEM-008` |
| No-change gate feedback | The native session can render a conforming gate with illustrative success checks even when the diff has no changes. `NO_CHANGES` must remain distinguishable from a validated implementation. | `BSH-SEM-017` |
| Promotion success feedback | TUI `/diff` and the headless auto-promotion path await promotion but ignore its returned status before printing success. An attempt is not a confirmed promotion. | `BSH-AGENT-013`, `BSH-TUI-013` |
| Headless completion | The headless return code is based on diff conformance rather than the agent's `completed` result. Its temporary worktree is removed in `finally`, including when changes were not promoted. | `AGENT` |
| Tool success tracking | `runAgentTurn` adds a path to `modifiedFilesSet` before attempting the write. A failed write can satisfy its action-progress heuristic. The requirement is concrete edits, not attempted edits. | `BSH-AGENT-002`, `BSH-AGENT-004` |
| Cancellation | The model request receives an abort signal, but workspace shell processes do not receive that signal. The TUI can mark execution idle before an in-flight tool finishes. | `BSH-INPUT-007` |
| Incremental diff preview | The session callback checks `write_to_file`, while the native catalog exposes `write_file`. Creation/overwrite events do not trigger the intended preview through that branch. | `BSH-TUI-008` |
| Domain fuzzy search | The model and skill selectors use fuzzy matching; the domain selector currently accepts a number or exact identifier. | `BSH-SELECT-008` |
| Catalog pricing | Model data retains pricing but the current model modal prints context limits without pricing. | `BSH-SELECT-009` |
| Skill invocation and completion | `/skill <name> <task>` and `/skill done` enter a modal branch because the subcommand discriminator recognizes only show/add/activate/deactivate. The later done/finish/close branch is unreachable for those inputs. Direct `/prototype` and `/done` take different paths. | `BSH-SKILL-008`, `BSH-SKILL-011` |
| Terminal controls | `Ctrl+G`, `Ctrl+L`, mouse-wheel tracking, and trailing-backslash continuation are described in older specifications but lack corresponding handlers in the current native session. `Ctrl+G` also has conflicting historical descriptions. | `GUARD`, `INPUT` |
| English interface | Numerous current labels and messages remain Portuguese in authentication, settings, skills, reasoning, receipts, queue badges, and alerts. The repository language policy requires English outside `.feature` files. | `BSH-TUI-001`, `BSH-DIST-010` |
| Usage telemetry | Native TUI initializes tokens to 1420 and adds 350 after a turn; cost falls back to $0.00. Estimated text tokens are not measured provider totals or a Codex-direct baseline. The usage/report helper contract remains distinct. | `BSH-TUI-010`, `EVAL` |
| Active rules | `/rules` displays fixed illustrative rules rather than querying the selected domain's actual shapes. | `BSH-TUI-012` |
| External MCP mutation governance | `readOnly` is retained as metadata; call dispatch does not enforce that flag or run the action approval broker. Catalog integration alone does not prove interception of external mutation. | `BSH-MCPC-005`, `BSH-MCPC-006` |
| MCP runtime management | Removing a server reloads configuration without closing the removed client or clearing its tools. Adding/reloading may reconnect existing entries. Success messages can be emitted after connection errors were caught. | `BSH-MCPC-007`, `BSH-MCPC-008` |
| Natural-language MCP connection | The native session may auto-configure `test/support/mock-context7-server.mjs` and announce Context7. A local mock is not proof of a real third-party connection. | `BSH-MCPC-009` |
| MCP proposal submission | Governed patch submission returns a digest without applying or persisting a patch. Observation proposals are persisted separately in the non-governed server tool set with verified evidence. | `MCPS` |
| Pilot API and formal rules | HTTP operations implement only a subset of the formal ontology. Allocation, maintenance, retirement, and transfer do not enforce all corresponding RDF constraints or human policies. Shapes constrain represented facts, not arbitrary TypeScript execution. | `ASSET` |
| RDF type inheritance | Domain vocabulary declares subclass relations. Do not assume those declarations cause SHACL validation of every superclass without confirming how facts and target selection are supplied. | `ASSET`, `ONT` |
| Legacy adapter | Repository policy and the authentication-domain guide require `bsh codex`; `src/cli.ts` currently routes only the native TUI and other listed commands. The legacy adapter scenarios are historical or blocked requirements, not available CLI behavior. | `LEGACY`, `BSH-EVAL-004` |
| Version consistency | The package and CLI advertise 0.2.11-beta, while MCP client/server metadata still contains 0.2.7-beta. | `BSH-DIST-007` |
| Video language | Evaluation specifications and E2E recording scripts use Portuguese introductory slides with black background and white typography, while supporting audit reports and technical artifacts remain in English. | `BSH-EVAL-008` |
| Palette constraints | The existing palette feature requires strictly empty input and descriptions without truncation up to 42 characters. Current key handling uses trimmed input and the renderer budgets descriptions dynamically and can add `..`. The original acceptance criteria are preserved. | `MENU` |

## Review boundaries

The extraction did not translate existing unrelated documentation, change runtime behavior, move domain ontologies, create automated behavioral tests, run agents, record E2E media, publish a release, commit, or push. Verification for this change checks the specification artifacts themselves. Existing tests were consulted as behavioral evidence, not executed or claimed as newly passing.
