# OpenTUI TUI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for native execution, or `superpowers:subagent-driven-development` if the user explicitly selects delegation. Steps use checkboxes for tracking. Repository policy overrides the skills' TDD defaults: implement first, then derive tests from `.feature` requirements.

**Goal:** Replace every manually built interactive TUI surface with OpenTUI components while preserving implemented BSH behavior.

**Architecture:** Keep domain services and session decisions separate from the terminal renderer. Compose imperative OpenTUI components for the session and dialogs, with one renderer and one owner of terminal input. Route noninteractive CLI commands without importing or initializing OpenTUI.

**Tech Stack:** TypeScript, ESM, npm, `@opentui/core` candidate `0.5.14`, existing Node test runner. Candidate packaged TUI runtime: npm `bun` `1.4.2`; retain the existing Node `>=22` launcher and noninteractive contract.

**Spec:** [design.md](design.md), [opentui-component-tui.feature](../../specs/opentui-component-tui.feature), and the existing capability features referenced there.

## Global Constraints

- Portuguese Gherkin `.feature` files are authoritative; update changed acceptance criteria before product implementation.
- All new code, UI text, tests, commits, and supporting documents are in English; `.feature` descriptions remain Portuguese with `# language: pt`.
- Baseline implemented behavior is commit `2afc270`. Preserve commands, shortcuts, history, FIFO input queue, multiline entry, streaming, governance, approvals, selectors, authentication, and session cleanup.
- OpenTUI owns layout, rendering, focus, scrolling, input, resize, and terminal restoration. No handwritten ANSI frames, cursor placement, border drawing, raw-readline widgets, or manual TUI fallback remain in production.
- Every surface uses GitHub Dark Dimmed shared tokens specified in `BSH-OPENTUI-014` through `016`; command accents follow the updated `BSH-MENU-004`. This user-requested palette supersedes the previous ANSI-256 values while preserving command identity and semantic meaning.
- Every surface adapts to actual terminal width under `BSH-OPENTUI-017` through `019` and updated `BSH-TUI-003`. No artificial minimum wider than the terminal; required controls/status stay usable through native wrapping, layout adaptation, and scrolling. Resize retains draft, query, selection, focus, and conversation position at 35/60/80/140 columns.
- Preserve Node `>=22` and npm distribution unless an explicitly reviewed runtime requirement supersedes them. Prove the packaged runtime approach before integrating the TUI; never silently raise the engine floor.
- Keep project ontologies in the owning project's `.bsh/domains/`; preserve governance services and domain data.
- No TDD. New automated tests follow implementation, derive from features, and use Given/When/Then names. Adapter tests use their existing `agy:`/`codex:` prefixes when applicable.
- Use `/usr/bin/rtk` for terminal commands. Functional journeys use the globally installed packaged `bsh`, with the required video, screenshot, report, token measurements, and matching-hash Downloads copies.
- No push until `npm run quality`, `npm test`, and `npm run test:e2e` pass locally. A blocked journey is reported as blocked.

## Review Focus

1. Node 22 npm installation with native packages or install scripts unavailable: noninteractive commands still work, and TUI startup returns an actionable English diagnosis.
2. Empty search results and cancellation during a dialog: no invalid selection, unwanted command, stranded focus, or pending promise.
3. Resizing or opening a dialog while streaming: retain prompt text, queued requests, stream content, and scroll position.
4. Ctrl+C/Escape during approval or an executing turn: preserve decision priority without renderer default termination or accidental approval.
5. Errors during authentication, renderer creation, external editor use, or shutdown: restore the terminal and release resources exactly once without exposing credentials.

## Task 1: Package and route the TUI runtime

**Files:** Modify `package.json`, `package-lock.json`, `src/cli.ts`, `scripts/prepare-bin.mjs`, and `README.md`; create `src/tui/runtime.ts` and `test/package/tui-runtime.test.mjs`. Update runtime acceptance in `openspec/specs/opentui-component-tui.feature` and `distribution-and-engineering-policy.feature` before integration.

**Interfaces:** `launchTui(options: TuiSessionOptions): Promise<void>` runs the compiled `startTuiSession` in the supported runtime. `src/cli.ts` imports this entry lazily only for the interactive route. `src/tui/runtime.ts` resolves the package-local Bun executable from the installed npm package; it preserves cwd, environment, selected project/model/domain, inherited terminal streams, signal forwarding, and child exit status. Bun execution calls the session directly without recursively spawning another runtime.

- [ ] Record the packaging decision in the runtime feature: Node 22 remains the launcher; the TUI uses package-local Bun without requiring a separate global installation. Missing native runtime produces an English diagnostic, not a manual-renderer fallback.
- [ ] Verify package metadata and install the pinned candidate dependencies. Prove package-local Bun resolution, supported platform artifacts, renderer import, and packaged launcher execution on the current Node 22.19 environment before migrating other surfaces. If the proof fails, record evidence and revise the runtime design with the user instead of proceeding on an unsupported assumption.
- [ ] Implement lazy CLI routing and runtime launching. Audit the `auth` CLI import path because it can currently import TUI modals indirectly; separate its noninteractive behavior from renderer imports.
- [ ] After implementation, add feature-derived tests: `Given Node 22 and an installed package, When help or init runs, Then OpenTUI is not loaded`; `Given a package-local Bun runtime, When the TUI launches, Then project options and terminal streams reach the child`; `Given an unavailable native runtime, When the TUI launches, Then an actionable diagnostic is returned`.
- [ ] Run the build, targeted package/CLI tests, and an isolated `npm pack` installation check. Commit the verified runtime integration.

## Task 2: Introduce the component session view

**Files:** Create `src/tui/state.ts`, `src/tui/view.ts`, `src/tui/entries.ts`, and `src/tui/theme.ts`; replace production rendering in `src/tui/render.ts`; adapt `test/tui/render.test.mjs` after implementation.

**Interfaces:** Move existing `RenderState`, `ChatEntry`, `GateCheckItem`, and `ReceiptFileStat` into `state.ts` without changing domain payload fields. `createTuiView(): Promise<TuiView>` creates one OpenTUI renderer. `TuiView.update(state: RenderState, entries: ChatEntry[]): void`, `getPrompt(): string`, `setPrompt(value: string): void`, `focusPrompt(): void`, `scrollBy(lines: number): void`, `scrollTo(edge: 'top' | 'bottom'): void`, `suspend(): void`, `resume(): void`, and `destroy(): void` define the terminal boundary. `entries.ts` composes entry components from the existing entry discriminated union.

- [ ] Compose header/status, conversation scroll container, input, and footer using supported Box, Text, ScrollBox/ScrollBar, and input components. Use supported styled text for colors; remove ANSI wrapping, frame padding, and cursor coordinates.
- [ ] Export a readonly `githubDarkDimmedTheme` from `theme.ts` containing the exact role values in `BSH-OPENTUI-014` and the 14 command accents in `BSH-MENU-004`. Apply these component properties consistently to every surface, including secret input, selectors, selection, scrollbars, semantic status, and diffs. Add post-implementation tests for shared theme properties, distinct command accents, semantic labels, and readable selected text.
- [ ] Implement every current entry type, progressive updates, collapsed reasoning, tool invocation summaries, semantic checks, queued badges, diff summaries, and implementation receipts. Render all user-visible labels in English.
- [ ] Preserve conversation identity and scroll state across updates instead of recreating the entire renderer per token. Keep header and footer visible during scrolling and respond to actual terminal dimensions.
- [ ] Derive component tests from TUI/OPENTUI features after implementation using OpenTUI's testing entry point under the supported runtime. Test all entry types, narrow/large terminal resize, empty conversation, scrolling, and preservation of prompt text during stream updates.
- [ ] Run quality and targeted component checks. Delete obsolete production frame helpers rather than keeping them for string-based tests; commit the component view.

## Task 3: Replace all dialogs and selectors

**Files:** Create `src/tui/dialogs.ts`; rewrite `src/tui/modals.ts`; retain filtering definitions in `slashCommands.ts` and fuzzy scoring in `fuzzySearch.ts` while removing terminal drawing; adapt `test/tui/modals.test.mjs` and `slash-menu.test.mjs` after implementation.

**Interfaces:** `TuiView` exposes `select<T>(options: SelectionDialog<T>): Promise<T | null>`, `question(options: QuestionDialog): Promise<string | null>`, and `notice(title: string, content: string): Promise<void>` through dialog composition. `SelectionDialog<T>` includes a title, an initial query, current selection, and items with label/description/value. `QuestionDialog` includes title, message, and a secret-input flag. Existing exported model/domain/skill/settings/diff/auth modal result contracts remain intact; the implementation uses the shared view rather than creating a second stdin listener or renderer.

- [ ] Compose searchable selections with OpenTUI input/select components. Preserve model and skill scoring, current-item hints, domain exact/numeric selection, palette filtering, cyclic navigation, Tab, cancellation, and unfiltered numeric shortcuts from the relevant features.
- [ ] Verify open selectors, palette, confirmations, and authentication at 35/60/80/140 columns using actual native captures; use available width with a palette maximum of72, keep mandatory controls and states visible/scrollable, and preserve query/selection/focus through resizing. Include a smaller-width usability probe.
- [ ] Replace first-access authentication with a secret input and supported status text while retaining browser PKCE/manual-key race behavior and credential persistence. Cancellation and failed web authentication must settle pending flows without exposing the entered key.
- [ ] Implement settings, diff review, semantic block notices, and confirmation using the shared dialog host; preserve each exported return type and default decision. Display help, rules, affinity, and skill details with text/scroll components.
- [ ] Keep the specified non-TTY textual command-selection contract separate from interactive widgets: plain line protocol/output has no ANSI frames and must not initialize the renderer.
- [ ] After implementation, derive tests for empty matches, cyclic/Tab navigation, query backspace, numeric selection only without a query, cancel returning focus, settings persistence, blocked promotion, and masked key input. Run targeted checks and commit the dialogs.

## Task 4: Integrate the session controller and lifecycle

**Files:** Modify `src/tui/session.ts`, `inputQueue.ts`, `history.ts`, and `exitGuard.ts`; create `src/tui/input.ts`; remove unused TUI ANSI helpers; update session ergonomics/advanced-UX tests after implementation.

**Interfaces:** `input.ts` adapts OpenTUI key/submission events into the existing session decisions. The session retains its queue, `ExitGuard`, confirmation resolver, abort controller, agent callbacks, service calls, and command dispatch. `TuiView.suspend()/resume()` provide the terminal handoff for the external editor; `destroy()` is idempotent.

- [ ] Replace readline, Writable filtering, alternate-screen sequences, raw key listeners, manual redraw, and terminal cleanup with the shared OpenTUI view and events. Disable renderer default Ctrl+C exit so `ExitGuard` retains priority.
- [ ] Preserve multiline triple-quote handling, history persistence, FIFO input during execution, model/domain shortcuts, slash palette, reasoning toggle, scroll commands, Escape confirmation cancellation, double-Escape interruption, and double-Ctrl+C exit.
- [ ] Route every session command's visible output through components, including help/rules/affinity/MCP/skills/diff/configuration. Preserve command services and governance decisions. Suspend/resume around the external editor, retaining input and session state.
- [ ] Ensure startup failures, dialog cancellation, agent exceptions, signals, and normal exit restore the terminal and release renderer/MCP/worktree resources. Audit all imported paths for remaining interactive readline/ANSI drawing.
- [ ] After implementation, derive tests for confirmation Enter/Escape, Ctrl+C priority, queued prompt order during streaming, history, model/domain persistence, dialog interruption, editor failure, and cleanup once. Run quality and session tests; commit the integrated session.

## Task 5: Verify the full behavioral contract and packaged journeys

**Files:** Create `openspec/changes/rebuild-tui-with-opentui/coverage.md` and `test/features/journeys/jornada-16-reconstrucao-opentui.feature`; adapt affected `test/e2e-live/` implementations only after product implementation; record dated evidence under `pilot/asset-management/evaluation/` and update catalog metadata.

**Interfaces:** The coverage matrix maps stable scenario IDs to migrated surfaces, verification commands, observed results, and unresolved gaps. Journey scenarios refer to capability requirements; no duplicate behavioral source of truth is introduced.

- [ ] Map all applicable baseline TUI/input/menu/selection/auth/skills/governance/affinity/session/CLI scenarios and all 19 OPENTUI migration scenarios to verification. Reconcile historical/gap scenarios explicitly without expanding unrelated domain work.
- [ ] Build and install the npm package in an isolated prefix for packaging checks; install the approved artifact as global `bsh` for functional sessions. Validate the pilot ontology before opening a persistent tmux session. Verify native agent capabilities under governance directly on the clean pilot copy.
- [ ] Execute planned native TUI journeys with a black/white objective slide, MP4 recording, final screenshot, and dated report. Report measured token overhead and savings with denominators; if a measurement is unavailable, record that limitation instead of inventing values. Copy required artifacts to the specified Downloads directory and verify identical SHA-256 hashes, requesting filesystem escalation only when needed.
- [ ] Run `/usr/bin/rtk npm run quality`, `/usr/bin/rtk npm test`, and `/usr/bin/rtk npm run test:e2e`. Resolve regressions; report environment-dependent blockers accurately. Check that production TUI paths contain no manual terminal frames/widgets. Refresh feature/index validation without treating baseline snapshot hashes as current source hashes after code migration.
- [ ] Update completion status and commit verified changes. Do not push, publish, or claim full functional approval while a required case is blocked.

## Plan review and execution handoff

The user approved this plan and selected subagent execution on 2026-10-03. Implementation tasks run sequentially to protect shared interfaces; read-only investigations and reviews use subagents wherever useful. The task ledger is under `.superpowers/sdd/implementation-plan/`. Native runtime compatibility is verified before migrating the component surfaces.
