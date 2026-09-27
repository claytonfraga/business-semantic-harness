# Business Semantic Harness

[![CI](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml)

The **Business Semantic Harness** helps you let a coding agent change your project **without letting it break your business rules**. You describe your domain once — its concepts, states and rules — as a small, verifiable model that lives with your project. From then on, whenever the agent works, the harness checks its changes against that model **on its own**. It does not trust the agent to notice or report a violation: if a change would break a rule, the harness stops it and asks you; if the change is fine, it promotes it to your branch. While the agent works, it stays in a separate copy of your project, so your own files are never touched until you accept the result, and the harness tells you how much the checks cost.

In short, it turns "I hope the agent respects my rules" into "the agent can propose anything, but a governed change is only accepted after passing my project's rules, independently of the agent".

### What it actually does

- **Keeps your rules with your project.** The ontology (JSON-LD) and the rules (SHACL) live under the project's `.bsh/` directory, are versioned with the project, and are loaded every time the harness opens a session. The installed package ships the engine; it never replaces or shares one project's rules with another.
- **Enforces independently of the agent.** Before a change is accepted, an enforcement layer reads the change, builds the relevant domain facts, evaluates them against the ontology and SHACL, and decides: conform, violation, needs human review, or undetermined. If a required fact cannot be established for a governed operation, the change is not treated as fine — it goes to a human.
- **Isolates the work.** The agent runs in a real Git worktree, on a session branch. Your main checkout stays untouched; only after the change passes the checks (and any human decision) does the harness promote it to your branch with Git.
- **Keeps you in control of judgement calls.** Rules that require human judgement are never decided automatically; the harness asks, records your decision, and never rewrites the rule to fit an exception.
- **Leaves a trail.** Every decision — facts used, shapes evaluated, policies found, result and human choice — is auditable under the project's `.bsh/local/`.
- **Keeps the model out of the loop when it can.** The ontology is processed locally; the agent only gets compact answers, so checking your rules does not mean shipping them into the prompt.

### Why it can be good

- Business rules stop being an unwritten expectation and become explicit, reviewable, versioned artifacts.
- A rule violation cannot slip through just because the agent forgot to mention it.
- Intermediate or rejected changes never pollute your working tree — no "restore after the fact".
- Human judgement is reserved for genuine judgement calls, with evidence and an audit trail.
- It sits **on top of** your existing quality tools (TypeScript, Biome, unit and E2E tests, Git, code review), which keep checking everything else.

The harness supports both **Codex** and **Agy** (Antigravity CLI).

## Requirements

- Linux with Node.js 22 or later and npm.
- **For Codex**: Codex CLI installed and authenticated (verified with `codex-cli 0.156.1`).
- **For Agy**: Antigravity CLI (`agy`) installed and authenticated (verified with `agy 1.2.10`).
- `git` available on Linux. Every session runs in an isolated Git worktree, so the project must be a Git repository.
- A project directory you can read and write.

## Installing the CLI

On this machine, version `0.0.2-beta` was packed and installed globally into the nvm-managed Node.js 22. The `bsh` executable is on that environment's `PATH` and can be called from any directory. The installation uses a copy of the package, independent of this checkout. To reproduce it, or to install your local changes:

```bash
cd /path/to/business-semantic-harness
npm install
npm pack --pack-destination /tmp
npm install -g /tmp/business-semantic-harness-0.0.2-beta.tgz
bsh --help
```

After changing the harness code, build and install a new tarball; the global installation does not track checkout changes. The package has **not been published to npm yet**. Once it is, `npm install -g business-semantic-harness` will install the executable globally.

### Installing from a GitHub release

Every tag `v*` runs the release workflow, which tests the project, packs the installable tarball, and attaches it to a GitHub Release together with a `SHA256SUMS` file. You can install straight from the release asset:

```bash
npm install -g https://github.com/claytonfraga/business-semantic-harness/releases/download/v0.0.2-beta/business-semantic-harness-0.0.2-beta.tgz
bsh --help
```

Or download the `.tgz` from the Releases page, verify it against `SHA256SUMS`, and install it locally:

```bash
sha256sum -c SHA256SUMS
npm install -g ./business-semantic-harness-0.0.2-beta.tgz
```

This is the standard, professional way to distribute a Node.js CLI: continuous integration on every change, and a tagged, reproducible, installable artifact per release. Standalone per-OS executables could be produced additionally, but the npm package is the primary and most reliable artifact.

## Preparing a project

Enter the directory of any Git project Codex should work on:

```bash
cd /path/to/my-project
bsh init
bsh domain add assets
```

This creates, **inside the project itself**:

```text
<project>/
  .bsh/
    project.json                              # manifest: lists the domains
    domains/
      assets/
        ontology.jsonld                       # domain ontology (JSON-LD 1.1)
        shapes.ttl                            # verifiable rules (SHACL, Turtle)
```

**One rule to remember:** a domain ontology belongs to the project it refers to and lives in `<project>/.bsh/domains/<domain>/`. Never place a project's ontology inside this package, in another project, or in a global directory. When you run `bsh codex` or `bsh agy`, the selected project must contain its own validated ontology — including when it is a working copy used in tests. The fixtures under `test/fixtures/` are synthetic ontologies for this package's unit tests, not project ontologies.

`bsh domain add` produces a skeleton that is structurally valid but **not ready**: you must describe the business concepts and write at least one rule or policy. The next two subsections show how.

### Creating the ontology (`ontology.jsonld`)

`ontology.jsonld` is JSON-LD 1.1 with an `@context` and a `@graph`. Use a local or embedded context — remote contexts are rejected — and keep file references inside the project. Describe three kinds of things:

1. **Classes** — the business entities and the actions, as `rdfs:Class`.
2. **Individuals** — named states or categories the domain talks about (for example `Disponivel`, `EmUso`, `Baixado`).
3. **Properties and policies** — `rdf:Property` for the facts an action carries, and `bsh:Policy` for rules that require human judgement.

A complete, minimal example:

```json
{
  "@context": {
    "ex": "urn:my-project:assets:",
    "bsh": "urn:bsh:ns:v1:",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  },
  "@graph": [
    { "@id": "ex:ontology", "@type": "bsh:Domain", "bsh:version": "1.0.0" },

    { "@id": "ex:Asset", "@type": "rdfs:Class", "rdfs:label": "Asset" },
    { "@id": "ex:AssetTransfer", "@type": "rdfs:Class", "rdfs:label": "Asset transfer" },

    { "@id": "ex:Available", "rdfs:label": "Available" },
    { "@id": "ex:InUse", "rdfs:label": "In use" },
    { "@id": "ex:Retired", "rdfs:label": "Retired" },

    { "@id": "ex:currentState", "@type": "rdf:Property",
      "rdfs:comment": "State of the asset before the action." },
    { "@id": "ex:newResponsible", "@type": "rdf:Property",
      "rdfs:comment": "Responsible party required by a transfer." },

    { "@id": "ex:adequate-justification", "@type": "bsh:Policy",
      "bsh:governs": { "@id": "ex:AssetTransfer" },
      "bsh:requiresHumanReview": true,
      "rdfs:comment": "A transfer requires an adequate justification." }
  ]
}
```

- `bsh:Domain` and `bsh:version` identify the domain and its version.
- `bsh:Policy` with `bsh:governs` marks rules that the harness will not decide automatically: `bsh:requiresHumanReview: true` forces a human decision when the corresponding action occurs.

### Creating the SHACL rules (`shapes.ttl`)

`shapes.ttl` is Turtle with SHACL Core constraints. Each shape targets a class and lists the conditions an action of that class must satisfy:

```turtle
@prefix ex: <urn:my-project:assets:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

ex:TransferShape a sh:NodeShape ;
  sh:targetClass ex:AssetTransfer ;
  sh:property [
    sh:path ex:currentState ;
    sh:minCount 1 ;
    sh:in ( ex:Available ex:InUse ) ;
    sh:message "A retired asset cannot be transferred."
  ] ;
  sh:property [
    sh:path ex:newResponsible ;
    sh:minCount 1 ;
    sh:message "A transfer requires a new responsible party."
  ] .
```

Common constraints you can use:

- `sh:minCount 1` — the property is required.
- `sh:in ( ... )` — the value must be one of the listed individuals.
- `sh:hasValue true` — the property must have that exact value.
- `sh:datatype` / `sh:nodeKind` — the value must have a given type.
- `sh:message` — the message shown when the rule is violated.

The harness evaluates these shapes against the facts of a proposed action. If the facts are incomplete or the action is not fully representable in RDF — which is common for code diffs — the harness does not claim automatic conformance: it asks you.

Repeat `bsh domain add <domain>` for every domain and list them all in `.bsh/project.json`. Each domain needs business concepts identified by IRI and at least one applicable SHACL constraint **or** an active human-review policy. See a full example in the [pilot ontology](pilot/asset-management/.bsh/domains/ativos/ontology.jsonld) and [pilot shapes](pilot/asset-management/.bsh/domains/ativos/shapes.ttl).

### Validating and inspecting

```bash
bsh ontology validate
bsh ontology show assets
bsh ontology show assets urn:bsh:pilot:ativos:Ativo
```

`validate` must print `Ontologia válida e pronta.` before a session can start; otherwise it reports the domain, file, and rule that block readiness. `show` returns JSON with concepts, relations, policies, shapes, and source paths. To operate from another directory, add `--project /path/to/my-project`.

## Running an Agent Session (Codex and Agy)

The harness supports both **Codex** and **Agy** (Antigravity CLI).

For both agents, running a governed session is direct and straightforward: **simply navigate to your project directory (which must contain `.bsh/` with its ontology, shapes, and project files) and type the command**:

```bash
cd /path/to/my-project

# For Codex:
bsh codex         # or: bsh code base

# For Agy:
bsh agy           # or with a specific model: bsh agy --model <model-name>
```

You can also run from any other directory by passing `--project /path/to/my-project`.

---

### Using with Codex

From the prepared project:

```bash
bsh doctor
bsh codex         # alias: bsh code base
```

On startup, the harness **opens the real Codex TUI** — the same interface you already use — connected to a `codex app-server` that it starts in an **isolated Git worktree** of the project. It sits around Codex as a wrapper: it injects the governance instructions, delivers the ontology context through a local MCP server, follows the session, measures the tokens spent on the domain checks, and raises alerts on violations.

The harness **does not modify your Codex installation**: it uses a private `CODEX_HOME` with a copy of `auth.json` and never touches `~/.codex`. By default it runs Codex with its sandbox in `workspace-write` mode rooted at the session worktree, so the agent cannot write to your main checkout; set `BSH_CODEX_SANDBOX=danger-full-access` to opt out. Type your requests in the TUI as usual, and exit with `/quit` or `Ctrl+C` so the harness can finalize the session.

---

### Using with Agy

From the prepared project:

```bash
bsh doctor agy
bsh agy                                  # uses your environment's default model
bsh agy --model gemini-3.7-flash-low     # or any specific model
```

On startup, the harness **opens the real Agy TUI** attached to your terminal, running inside an **isolated Git worktree** of the project under BSH governance:

- **Isolated private environment**: Agy runs with a private `$HOME` (`bsh-agy-home-*`, mode `0700`) with a selective copy of credentials (`oauth_creds.json`, token and client IDs), never modifying or polluting your global `~/.gemini`.
- **Zero interactive friction**: Automatically pre-trusts the session worktree in `trustedFolders.json` and `settings.json`, marks onboarding as completed in `cache/onboarding.json` (bypassing the initial theme/welcome wizard), and sets `--dangerously-skip-permissions` scoped strictly to the session worktree so MCP tools execute seamlessly.
- **Ontology MCP injection**: Automatically configures the BSH MCP server in `.gemini/config/mcp_config.json`, allowing Agy to call `bsh_query_ontology` and `bsh_report_conflict`.
- **Exit & Enforcement**: When you exit the Agy TUI, the harness inspects recorded ontology queries and alerts, runs independent SHACL semantic enforcement, evaluates project gates (`npm test`), and promotes changes with Git (or cleanly discards the worktree if an exception is rejected).

---

### Isolation, Promotion, and Exceptions (Common to Codex and Agy)

**Isolation and promotion.** The harness identifies the current branch and its HEAD, creates a session branch `bsh/session/<id>` and a real `git worktree` (outside your project, in a private state directory), and starts the agent there. Your main checkout stays untouched while the agent works, so you can keep using it. When the session ends, the harness runs the project's gates in the worktree and **promotes the changes with Git** — fast-forward when the origin branch has not moved, or a rebase inside the worktree when it has. Promoted commits reach the origin branch; the temporary worktree and branch are then removed. The harness never resets, cleans, or force-pushes your main checkout, and never runs `stash`/`reset`/`restore`/`clean` to make room for a session.

```bash
bsh codex --project /path/to/my-project
bsh agy --project /path/to/my-project
```

Each project needs its own `.bsh/project.json`, JSON-LD, and SHACL; a freshly initialized project is only ready after you define its concepts and rules and `bsh ontology validate` passes.

**Conflicts and exceptions.** When the agent reports a conflict with the ontology (through the `bsh_report_conflict` tool), the harness records an alert in `.bsh/local/alerts.jsonl` and, at the end of the session, asks for your decision:

- **Ontology respected** (no conflict reported): the changes are promoted to the origin branch.
- **Violation or uncertainty**: you can **approve the exception** (the changes are promoted) or **deny it**. If you deny it, the harness **discards the session worktree and branch**; your main checkout never needed a rollback.

The harness **does not answer** native approvals in the agent (for example, running `npm test`); those remain your decisions in the TUI.

**Session recovery.** Each session records its metadata under `.bsh/local/sessions/` (not versioned). You can list sessions and orphan worktrees, and remove a discarded one:

```bash
bsh sessions list
bsh sessions clean <id>
```

## Token accounting

The harness acts **before** the agent implements anything: the context and the ontology tools are delivered up front, and the agent is instructed to consult the ontology before changing rules. Consulting early and blocking a wrong path avoids rework and reduces the total tokens spent with Codex. At the end of the session it prints a summary with:

- input, output, cache, and reasoning tokens, plus the total;
- the number of ontology queries and reported conflicts.

The summary is also written to `.bsh/local/`, alongside the audit trail. Codex shows live token usage in its own TUI.

For source code, the link between a diff and RDF facts is partial: the harness **does not claim that SHACL proved the code's behavior**. A governed candidate is promoted only when a trusted host extractor supplies the resulting RDF graph, attests to the candidate commit, and accounts for every relevant changed path. Static facts in an enforcement rule do not establish this proof. When no trusted extractor is available, the candidate remains indeterminate and promotion is blocked. SHACL Core and SHACL-SPARQL run on the supplied candidate graph; the promotion gate rechecks the commit, worktree, ontology, shapes, policy, and graph fingerprint after technical gates. Human approval cannot override a semantic violation or missing validation. Direct patch application to a governed origin is blocked; use the worktree promotion path.

## Code quality

Before running the tests, the project goes through a quality gate:

```bash
npm run quality   # tsc --noEmit + Biome (lint)
npm test          # runs the gate (pretest) and then the tests
```

- `npm run check` — type checking with TypeScript.
- `npm run lint` — static analysis with [Biome](https://biomejs.dev) (configured in `biome.json`), the JavaScript/TypeScript counterpart to Ruff in Python.
- `npm run quality` — both of the above, run automatically before `npm test`.

## Benchmark: the harness vs. plain Codex

The `benchmark/` directory measures the harness's token cost and governance effect against plain Codex, running the **same prompt** on clean copies of a project. The two conditions are plain Codex (`codex exec --json`) and Codex under the harness (`bsh codex`).

```bash
python3 -m venv --system-site-packages benchmark/.venv
BENCH_RUNS=10 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \
  benchmark/.venv/bin/python benchmark/run_benchmark.py
benchmark/.venv/bin/python benchmark/analyze.py
```

Each run is a **batch** under `benchmark/results/<timestamp>/` containing the numbered executions, the discarded warm-up, and its own artifacts: `charts/`, `stats.md`, `stats.json`, and `measurements.csv`. The methodology and best practices are documented in `benchmark/README.md`.

Result with a prompt the ontology **blocks** (10 runs per condition, `gpt-6-sol` at `low` effort):

| Condition | n | Mean tokens | Std. dev. | 95% CI | Blocks |
| --- | --- | --- | --- | --- | --- |
| Codex alone | 10 | 256,673 | 103,601 | +/- 74,106 | 0/10 |
| Codex under the harness | 10 | 85,804 | 10,894 | +/- 7,792 | 10/10 |

The harness blocked the ontology-violating prompt in 10/10 runs and cut the mean token cost by **170,869 tokens (-66.57%)** (paired Cohen's d_z = 1.74; Wilcoxon signed-rank p = 0.00195). Plain Codex applied the violating change in 10/10 runs. With an **adherent** prompt the difference is small, and the harness spends extra tokens on the ontology query; the payoff is largest when a request needs course correction before implementation.

## Pilot project

The codebase under [pilot/asset-management](pilot/asset-management) is an independent web application for asset transfer, retirement, responsible party, and location. Its ontology and SHACL are its own. You can verify both:

```bash
npm test --prefix pilot/asset-management
bsh ontology validate --project pilot/asset-management
```

The pilot server builds with `npm run build --prefix pilot/asset-management` and runs with `node pilot/asset-management/dist/server.js`. The API lists assets at `GET /assets` and accepts operations at `POST /assets/{id}/transfer`, `/retire`, `/responsible`, and `/location`.

The functional E2E test requires opening `bsh codex` or `bsh agy` in a persistent `tmux` or `herdr` session and asking the agent for code changes that are adherent and contrary to the ontology. The rule is defined in [AGENTS.md](AGENTS.md). Evaluation reports are available for [Codex](pilot/asset-management/evaluation/functional-e2e-2026-09-23-run.md) and for [Agy](pilot/asset-management/evaluation/functional-e2e-agy-2026-09-24-run.md). Direct HTTP tests of the pilot do not prove the harness's governance.

## Project status

The ontology base, the decision core, the audit trail, the pilot, and the governed sessions with Git worktree isolation for both **Codex** and **Agy** are runnable. Knowledge capture for review and the A/B/C evaluation are still in progress, tracked locally in the `openspec/` directory (kept out of version control). The package is installed globally on this Linux host from a local tarball, but has not been published to npm.
