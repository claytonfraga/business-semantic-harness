# OpenTUI Migration Coverage Matrix

Date: 2026-10-03
Branch: `feature/opentui-component-tui-rewrite`

## Summary
This matrix maps the behavioral requirements and scenario IDs across all OpenTUI migration specs (`openspec/specs/opentui-component-tui.feature`, `menu-de-comandos-barra.feature`, `tui-layout-and-feedback.feature`) to implemented surfaces and verification evidence.

## Requirements & Scenarios Mapping

| Requirement / Scenario ID | Description | Implementation Surface | Verification Evidence | Status |
| --- | --- | --- | --- | --- |
| `BSH-OPENTUI-001` | Dedicated OpenTUI runtime with Bun | `src/tui/runtime.ts` | `test/package/tui-runtime.test.mjs` | Verified |
| `BSH-OPENTUI-002` | Node.js global distribution CLI | `src/cli.ts` | `npm run build && node dist/cli.js --help` | Verified |
| `BSH-OPENTUI-003` | Package-local Bun execution | `package.json` (`bun`), `src/tui/runtime.ts` | `test/package/tui-runtime.test.mjs` | Verified |
| `BSH-OPENTUI-004` | GitHub Dark Dimmed palette | `src/tui/theme.ts` | `test/support/opentui-components.fixture.mjs` | Verified |
| `BSH-OPENTUI-005` | Floating slash palette component | `src/tui/dialogs.ts`, `src/tui/modals.ts` | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-006` | Native input event ownership | `src/tui/input.ts`, `src/tui/view.ts` | `test/tui/input.test.mjs` | Verified |
| `BSH-OPENTUI-007` | Conversation streaming & card lifecycle | `src/tui/view.ts` (`TuiView`) | `test/support/opentui-components.fixture.mjs` | Verified |
| `BSH-OPENTUI-008` | Dialogs and governance modals | `src/tui/dialogs.ts`, `src/tui/modals.ts` | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-009` | Secret masking in question dialog | `src/tui/dialogs.ts` (`MaskedInput`) | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-010` | Resource cleanup on destroy | `src/tui/view.ts`, `src/tui/session.ts` | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-011` | Plain textual command fallback (non-TTY) | `src/tui/modals.ts` (`textHost`) | `test/tui/modals.test.mjs` | Verified |
| `BSH-OPENTUI-012` | Elimination of handwritten ANSI frames | `src/tui/session.ts` (pure OpenTUI) | Zero manual ANSI escapes in session | Verified |
| `BSH-OPENTUI-013` | Packaged product execution parity | `package.json`, `dist/cli.js` | `npm test` & `npm run test:e2e` pass | Verified |
| `BSH-OPENTUI-014` | Distinct command accents | `src/tui/theme.ts`, `slashCommands.ts` | `test/tui/slash-menu.test.mjs` | Verified |
| `BSH-OPENTUI-015` | Palette navigation & Tab cycle | `src/tui/dialogs.ts` | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-016` | External editor suspend & resume | `src/tui/session.ts` (`/editor`) | `view.suspend()` & `view.resume()` | Verified |
| `BSH-OPENTUI-017` | Width responsiveness (35/60/80/140 cols) | `src/tui/dialogs.ts`, `src/tui/view.ts` | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-018` | Query, selection, focus persist on resize | `src/tui/dialogs.ts` (`renderer.on('resize')`) | `test/support/opentui-dialogs.fixture.mjs` | Verified |
| `BSH-OPENTUI-019` | Scrollable detail & vertical budgeting | `src/tui/dialogs.ts` (`ScrollBoxRenderable`) | `test/support/opentui-dialogs.fixture.mjs` (35x24) | Verified |

## Slash Command Palette (`BSH-MENU-001` .. `011`)

- `BSH-MENU-001`: Floating slash palette above prompt, <= 72 columns, header `(1-5 of 14) • ↑/↓ scroll`, metadata row display (name, shortcut, concise description).
- `BSH-MENU-002`: Literal `/` character when prompt already contains text.
- `BSH-MENU-003`: Real-time fuzzy query filtering with matched character highlight.
- `BSH-MENU-004`: Interactive windowed navigation with exclusive GitHub Dark Dimmed colors and `❯` pointer.
- `BSH-MENU-005`: Safe cancellation via Escape or Backspace on empty query.
- `BSH-MENU-006`: Enter or numeric selection dispatches command cleanly.
- `BSH-MENU-007`: "No match" indicator on non-matching query without dispatching.
- `BSH-MENU-008`: Cyclic Tab / arrow navigation.
- `BSH-MENU-009`: Backspace editing without dispatching.
- `BSH-MENU-010`: Direct digit selection without query.
- `BSH-MENU-011`: Plain textual fallback in non-TTY environments.

## Verification Gates
- `npm run quality`: Passed (tsc --noEmit && biome lint src)
- `npm test`: Passed (279/279 tests pass across all suites)
- `npm run test:e2e`: Passed (49/49 live adversarial and worktree isolation tests pass)
- **Journey 16 E2E Execution (`batch-20261003-opentui`)**:
  - Global `bsh` binary packaged and executed in tmux on clean pilot copy.
  - Video (`evaluation/videos/bsh-opentui-reconstruction-scenario.mp4` / `bsh-jornada-16-batch-20261003-opentui.mp4`): `fa45fb23e265fe5dc383e5535543533d69df826bd558e226bb657673b4e24e6d` (identical SHA-256 in WSL Downloads `/mnt/c/Users/clayt/Downloads/bsh`).
  - Screenshot (`evaluation/screenshots/bsh-opentui-reconstruction-scenario.png` / `bsh-jornada-16-batch-20261003-opentui.png`): `53fd10b53fe4e1cc120d542c3d2532ec6e4883725f4716374ae56e45877af416` (identical SHA-256 in WSL Downloads `/mnt/c/Users/clayt/Downloads/bsh`).
  - Execution Report: `pilot/asset-management/evaluation/functional-e2e-2026-10-03-run.md`.

