# Oracle decision core implementation plan

**Scope:** OpenSpec tasks 3.1–3.3. This module evaluates represented actions, asks a human when needed, and writes an auditable decision before any mutable effect. Codex integration follows in task 4.

**Contracts:** `specs/policy-approval/spec.md`, `design.md` sections 2, 3 and 5. The ontology loader, SHACL validator and content snapshot from the first milestone are prerequisites.

## Implementation sequence

1. **Action representation and evaluation (3.1).** Define a `ProposedAction` with id, tool, arguments, domain, mutability, representation confidence and observed RDF facts. Build an RDF/JS action graph only from supplied facts. Load the selected domain ontology and shapes. A conforming, fully represented action with an applicable shape may be allowed; SHACL violations, human policies, missing required facts and opaque mutable actions produce `needs-human`. Unknown mutable tool surfaces produce `deny-on-failure` before effects. Each evaluation carries snapshot digest, rule IRIs and SHACL results.
2. **Approval broker (3.2).** Accept `needs-human` evaluations through an injected question callback. The question contains action, domain, rules, known consequences and one-time allow/deny choices. Bind the answer to a digest over action ID, tool, normalized arguments and ontology snapshot. Timeout, callback failure or changed digest deny. Never reuse an approval for a second execution.
3. **Audit trail (3.3).** Append events under `.oracle/local/` with restrictive permissions. Record action ID, digest, snapshot, rules, evaluation, decision, actor, reason and time. Redact known secret values before serialization. If writing fails, the broker returns denial and does not release the action.
4. **Final quality verification.** After implementation, derive unit, integration and CLI/process tests only from the OpenSpec contracts. Name every case `Given ..., when ..., then ...`. Include adversarial variants for altered arguments, missing facts, unanswered prompts, audit failure and unknown mutating tools. Run build, type check, tests and strict OpenSpec validation. Update tasks 3.1–3.3 only after evidence exists.

## Boundaries

- The decision core has no Codex SDK dependency; its caller must prove that a tool event was intercepted before any effect.
- SHACL conformity alone is insufficient when action facts or the applicable domain are uncertain.
- The broker cannot itself perform actions; it returns a one-time grant to the caller only after audit persistence.
