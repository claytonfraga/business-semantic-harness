# Codex adapter implementation plan

**Scope:** OpenSpec tasks 4.1–4.4, revised after checking Codex CLI 0.156.1 and the current official app-server and hooks documentation.

1. Implement a JSON-RPC stdio client for `codex app-server`: initialize/initialized, `thread/start`, `turn/start`, notifications, interruption, and server requests. Deny native command and file elevation requests. Use generated protocol bindings for the pinned Codex version where practical. Unit and process integration tests come after implementation, using Given/When/Then names.
2. Build required local MCP server for ontology query and explicit proposal submission. Check startup and tool discovery before a turn. Keep the server read-only with respect to approved ontology files.
3. Add mediated mutation tools and an authenticated local broker channel. Run Codex in `readOnly`; deny native elevation. Hooks observe supported tools and provide context, but are not treated as a complete enforcement boundary. Contract tests must show that every enabled mutating path in Codex 0.156.1 is blocked or mediated. Fail session startup if that cannot be shown.
4. Implement `oracle doctor` and `oracle codex` only after the MCP server and isolation proof are working. Doctor reports version, protocol, authentication, ontology readiness, sandbox, MCP startup and hook trust. Codex command supplies project/domain context before the first turn and preserves native interactive approvals where they do not bypass Oracle policy.
5. At the end, run OpenSpec-derived unit, integration, and end-to-end tests, plus strict OpenSpec validation. Do not mark a task complete based on transport smoke tests alone.

**Protocol evidence:** `codex app-server generate-ts --out /tmp/oracle-codex-bindings` ran against CLI 0.156.1. Official docs: [app-server](https://learn.chatgpt.com/docs/app-server), [hooks and coverage](https://learn.chatgpt.com/docs/hooks).
