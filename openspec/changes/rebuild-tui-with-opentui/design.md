# OpenTUI component migration design

## Intended outcome and authoritative contract

Rebuild the entire interactive TUI using OpenTUI components, keeping implemented commands, shortcuts, workflow, state transitions, and governance outcomes. Replace manual construction throughout the session, authentication, palette, selectors, settings, confirmations, and auxiliary dialogs. The user explicitly requested this architecture and Portuguese Gherkin as the source of truth.

Acceptance lives in [opentui-component-tui.feature](../../specs/opentui-component-tui.feature) and the existing capability features. Journey features define execution plans. The `@gap`, `@historical`, and `@example` tags in the catalog do not prove current implementation. Reconcile discrepancies explicitly rather than allowing a renderer migration to change the domain contract unnoticed.

## Chosen approach

Use `@opentui/core` imperative components with a session controller independent of rendering. This fits the existing TypeScript code and avoids adding a React or Solid application framework. Composition may contain application-specific data bindings and event routing, but terminal widgets and painting belong to OpenTUI.

A React or Solid renderer would add a framework and its lifecycle to a project that currently has neither. Retaining the manual renderer behind an OpenTUI wrapper would leave the forbidden construction in production. The recommended approach replaces the renderer and widgets themselves.

## Responsibilities and component map

| Surface | Current implementation | Target responsibility |
| --- | --- | --- |
| Session layout and status | `src/tui/render.ts`, `session.ts` | OpenTUI layout containers and text components |
| Conversation, streaming, reasoning, tool cards and diffs | `render.ts`, callbacks in `session.ts` | Text components in a scroll container, driven by session state |
| Prompt editing, focus and keyboard input | `session.ts`, raw readline | OpenTUI input components and keyboard events |
| Slash palette and fuzzy selectors | `slashCommands.ts`, `modals.ts` | Input and selection components with existing filtering logic |
| Authentication, settings and confirmations | `modals.ts`, session confirmation state | Composed OpenTUI dialog surfaces and input/selection components |
| Help, rules, affinity and promotion output | console/question paths in `session.ts` | OpenTUI text/scroll/dialog composition |
| Shutdown, resize and terminal restoration | `ansi.ts`, `exitGuard.ts`, `session.ts` | Renderer lifecycle with existing session resource cleanup |

Retain reusable domain logic such as fuzzy scoring, history persistence, FIFO queueing, exit decisions, command definitions, and service calls when it does not draw terminal widgets. Remove production use of manual ANSI frame construction, cursor coordinates, and raw-readline interactive widgets. Business state and semantic enforcement remain independent of the rendering library.

## State and event flow

The session controller owns conversation entries, prompt processing, active model/domain/skills, execution status, approval state, and queued inputs. OpenTUI events dispatch commands or update selection/input state; controller updates drive component properties. Agent streaming callbacks update the same state without creating a competing stdin consumer. Dialogs own focus temporarily, return a selection or cancellation, and restore prompt focus. Scroll position and resize are handled through components without discarding conversation or entered input.

Ctrl+C, Escape, confirmation cancellation, double-Escape interruption, queueing during execution, slash filtering, and command shortcuts follow the existing features. Renderer default Ctrl+C termination must not bypass the existing exit-state logic. Shutdown always destroys the renderer and then releases MCP/session resources, including exceptional startup and runtime paths.

## Runtime and distribution compatibility

The project currently declares Node `>=22`, publishes an npm CLI, and uses ESM. The official OpenTUI core documentation consulted on 2026-10-03 states Bun `>=1.3.0` or Node `>=26.4.0` with `--experimental-ffi`. Therefore adopting the latest package without changing the launcher is not proven compatible with the current runtime contract.

Before product integration, verify a pinned package, its native artifacts, launcher behavior, and packaged execution against the declared supported runtime. If preserving Node 22 cannot be demonstrated, present the concrete runtime/launcher change and update the authoritative runtime scenarios before implementing it. Do not silently raise the engine requirement or conceal incompatibility with a handwritten fallback. Noninteractive commands remain independent of renderer initialization.

Primary references: [OpenTUI core README](https://github.com/anomalyco/opentui/blob/main/packages/core/README.md) and [official repository](https://github.com/anomalyco/opentui). These describe the candidate library; local packaging checks must establish actual project compatibility.

## Behavioral traceability and verification

Build the migration coverage matrix from the baseline features for TUI layout, input, slash commands, selection, authentication, skills, governance, affinity, session isolation, and CLI/headless behavior. Map each applicable scenario to a controller/component surface and verification evidence. Source snapshot hashes record the reviewed baseline and must not be confused with proof of future implementation.

After implementation, derive meaningful automated tests from the feature criteria using Given/When/Then names. Replace assertions tied to manual ANSI implementation with behavioral evidence rather than preserving the renderer for old tests. Plan functional journeys in `test/features/journeys/` before execution, using the packaged global BSH, terminal screenshots, videos, and the existing evaluation policy. Record unsupported adapter startup as blocked when required; never report documentation parsing as a successful functional run.

The local quality, unit, and E2E commands remain required before any push. No push or release is part of this preparation. Product completion is evidenced only after the migrated surfaces and compatibility requirements are verified.

## Preparation status

The catalog is committed, the feature branch is open, and architecture/source-of-truth rules are recorded in OpenSpec and repository guidance. Runtime code and dependencies are unchanged. Written-spec review precedes the detailed implementation plan under the applied architectural workflow.
