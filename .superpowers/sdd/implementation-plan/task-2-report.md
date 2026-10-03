# Task 2 implementation report

Date: 2026-10-03

Implemented the OpenTUI session graph with native Box, Text, ScrollBox and Textarea components. The graph retains card and text-row identity during incremental updates; changes to the conversation do not recreate the prompt editor or renderer. Header and footer reserve three and four rows, respectively. Native layout, wrapping, input editing, focus, selection, resize and scrolling remain OpenTUI responsibilities.

All eleven existing entry discriminants are supported, with English labels, queued badges, semantic gate checks, collapsed/expanded reasoning indicators, diff summaries with styled addition/removal counts, and receipts distinguishing workspace writes from promotion. Shared immutable GitHub Dark Dimmed tokens include the exact fourteen command accents from the binding features.

## Integration API

`createTuiView(options?: { renderer?: CliRenderer }): Promise<TuiView>` creates the production renderer or accepts the official test renderer.

The returned object exposes:

- `renderer: CliRenderer`, `root: BoxRenderable`, `input: TextareaRenderable`, `scroll: ScrollBoxRenderable` for dialog composition and supported session integrations.
- `update(state: RenderState, entries: ChatEntry[]): void` updates chrome and changed cards without replacing the editor.
- `getPrompt(): string`, `setPrompt(value: string): void`, `focusPrompt(): void` operate on the native text editor. Prompt strings can contain newlines; no application maximum length is imposed.
- `scrollBy(lines: number): void`, `scrollTo(edge: 'top' | 'bottom'): void` delegate to the native scroll box.
- `onSubmit(listener: (prompt: string) => void): () => void` subscribes to native submit. The listener controls clearing/dispatch; submission does not implicitly clear the prompt.
- `onKeypress(listener: (event: KeyEvent) => void): () => void` subscribes to public global routing. Listeners consume exclusive shortcuts with `event.preventDefault()` before focused input insertion.
- `suspend(): void`, `resume(): void`, `destroy(): void` delegate terminal lifecycle to the renderer. Resume restores prompt focus; destroy is idempotent and removes subscriptions.

Theme export: `githubDarkDimmedTheme` has `background`, `panel`, `recessed`, `text`, `muted`, `emphasis`, `border`, `subtleBorder`, `accent`, `selection`, `success`, `warning`, `error`, `reasoning`, and frozen `commands` keyed by the slash command names.

State types live in `state.ts`: `RenderState`, `ChatEntry`, `GateCheckItem`, `ReceiptFileStat`. `render.ts` reexports them so existing consumers compile during staged integration. `createEntryComponent(renderer, id)` returns `{ component: BoxRenderable, update(entry): void }`; `entries.ts` also exports the plain `formatToolInvocation` formatter.

## Verification

Commands executed through `/usr/bin/rtk`:

- `npm run quality`: passed TypeScript and Biome.
- `npm run build`: passed.
- `node --test test/tui/opentui-components.test.mjs`: passed the Node wrapper and four official component scenarios under package-local Bun 1.4.2.

Tests were written after implementation against BSH-OPENTUI-006/007/010/013/014/015, BSH-TUI-005 and BSH-MENU-004. Captures verify every entry type, English semantic labels, warning/error versus success colors, collapsed reasoning privacy, shared exact palette values, distinct accents, native selected text contrast, progressive card identity, retained prompt across narrow/large resize, sticky bottom and manual top preservation, clear feed, and native submission/global event consumption. The Node wrapper removes inherited `NODE_TEST_CONTEXT` before spawning `bun test`; fixtures are outside Node's test file globs.

## Deferred integration and limits

Per the root integration ruling, existing manual render exports remain temporarily callable by the old session. Task 4 must replace the session boundary and delete those exports and string-frame tests; this staged task is not a claim that migration is complete. Slash palette and dialogs are task 3; this view exposes the renderer/root boundary needed for those native components. Agent commands and shortcuts are routed by task 4, rather than implemented in the view. Actual terminal dimensions override legacy state width/height fields. Narrow telemetry is clipped by its native fixed row; no manual truncation or terminal padding is used. This task did not run a packaged functional journey or E2E, and produces no E2E success claim or screenshot/video evidence.
