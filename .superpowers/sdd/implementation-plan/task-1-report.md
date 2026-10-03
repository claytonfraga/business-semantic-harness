# Task 1 runtime integration report

Date: 2026-10-03. Requirement sources: BSH-OPENTUI-011/012 and BSH-DIST-002. Both feature files were updated before implementation. No functional journey was executed or claimed by this packaging task.

## Interfaces and behavior

`src/tui/runtime.ts` exports `launchTui(options: TuiSessionOptions): Promise<void>` and `resolvePackageBun(): string`. Node lazily imports this module only for the interactive route. It resolves `bun/package.json` relative to the installed BSH package, then its `bin/bun.exe` artifact, without PATH/global lookup. The launcher inherits cwd, environment and stdin/stdout/stderr, serializes project/model/domain options, forwards SIGINT/SIGTERM/SIGHUP, removes handlers on completion and preserves child status (including conventional signal statuses). When already running under Bun it imports and calls `startTuiSession` directly. CLI returns the resulting exit code instead of overwriting it with zero.

The compiled runtime entry is included through the existing `dist/` package inclusion and receives executable permissions in prepare-bin. Runtime import is deferred, so Node 22 noninteractive commands do not load session or OpenTUI.

Auth import audit: `src/cli/authCommand.ts` imports readline, config/userStore, browser PKCE and `tui/ansi.ts`; it does not import modals, session or OpenTUI. Existing status/logout/browser command behavior remains separate from the renderer. Manual readline and ANSI presentation remain pending task 3; no auth implementation was modified here. The type-only session import in runtime emits no runtime import.

## Package compatibility proof

Current environment: Node v22.19.0, npm 11.19.0, Linux x64. Exact dependency versions: Bun 1.4.2 and OpenTUI core 0.5.14, committed with lockfile.

- `npm view bun@1.4.2 version optionalDependencies bin --json`: package artifacts include Linux, Darwin, FreeBSD and Windows x64/aarch64 variants, Linux musl and Android variants. Installed runtime path: `node_modules/bun/bin/bun.exe`.
- `npm view @opentui/core@0.5.14 version engines optionalDependencies --json`: native artifacts cover Linux, Darwin and Windows x64/ARM64 plus Linux musl. Declared engines are Bun >=1.3.0 and Node >=26.4.0.
- `npm install --save-exact bun@1.4.2 @opentui/core@0.5.14`: passed, 14 packages added, zero reported vulnerabilities. Upstream EBADENGINE warning on Node22 is expected and documented.
- Package-local Bun `--version`: 1.4.2. Importing `@opentui/core` under that executable returned `typeof createCliRenderer === 'function'`.
- `npm pack --pack-destination /tmp`: passed, `/tmp/business-semantic-harness-0.2.11-beta.tgz`.
- `npm install --prefix /tmp/bsh-task1-install /tmp/business-semantic-harness-0.2.11-beta.tgz --include=optional`: passed, 611 packages installed. The isolated package resolves its own Bun native binary and imports OpenTUI successfully. Installed `.bin/bsh --help` succeeded under Node22.
- Installed launcher dispatch proof: temporarily substituted only the isolated installed `dist/tui/session.js` with an observation fixture, invoked installed `.bin/bsh tui --project /tmp/bsh-task1-install --model probe/model --domain probe`, observed exact option serialization and exit status 7, then restored the installed session byte-for-byte. This verifies runtime dispatch, not interactive product behavior.
- `npm install --prefix /tmp/bsh-task1-strict ... --engine-strict --ignore-scripts --offline`: failed with EBADENGINE because OpenTUI declares Node>=26.4.0. README explicitly documents this limitation; no claim that engine-strict Node22 installation succeeds.

All terminal commands above used `/usr/bin/rtk`.

## Verification

- `npm run build`: passed.
- `npm run quality`: passed (TypeScript and Biome).
- `node --test test/package/tui-runtime.test.mjs`: 3 passed after implementation; proves lazy help/init imports, child options/cwd/environment/inherited streams/status and actual CLI exit assignment, actionable missing-runtime diagnostic.
- `node --test test/package/global-bin.test.mjs`: 1 passed independently.
- `npm test`: passed, 273 tests, zero failures (quality/build included). This run predates the final additional actual CLI exit assertion; that assertion passed in the targeted rerun.

During test development a Bun stdin-stream fixture awaited EOF indefinitely; replaced with synchronous fd0 reading and a subprocess timeout. An early combined package run consequently failed; fresh targeted and full-suite runs passed. This was fixture behavior, not a retained product fallback.

Combined targeted runs exposed an additional existing `global-bin` test failure; the test passes independently and the full npm suite passed. The existing global-bin test was left unchanged as outside task scope. Runtime fixture pipe input could also hang in isolated multi-file runs; using an inherited regular file descriptor gives deterministic EOF while still verifying stdin inheritance. The new tests remove the Node test-runner protocol variable only in fixture environments. Final `node --test test/package/tui-runtime.test.mjs test/cli/*.test.mjs` passed all three file suites. The unresolved global-bin combined-run behavior is not presented as an approved check.

## Decisions and concerns

No global Bun requirement and no engine bump. Standard npm installation on Node22 is empirically proven, with upstream warning. Engine-strict rejects the OpenTUI dependency on Node22; this remains an explicitly documented installation limitation. Only current Linux x64 native execution was empirically verified; other supported artifacts were verified through registry metadata, not runtime execution. No supported-platform claims extend to FreeBSD/Android for OpenTUI.

No manual renderer was migrated or retained as a new fallback; existing TUI remains the next migration task. No network sandbox escalation was necessary. No push or CI dispatch occurred, and no E2E approval is claimed. Signal forwarding is implemented; terminal ownership and component shutdown will be verified by subsequent renderer lifecycle tasks.
