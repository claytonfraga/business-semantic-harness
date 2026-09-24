# Oracle for Codex

Oracle uses the ontology of **your own project** to give Codex context, verify representable actions, and ask for your decision whenever there is a conflict or insufficient information. **The JSON-LD ontology and the SHACL rules are part of the Oracle harness of each project and each domain**: they live under the project's `.oracle/` directory, are versioned with that project, and are loaded whenever Oracle opens a session for it. The global package ships the engine and the `oracle` command; it neither replaces nor shares one project's ontology with another. Agent findings are recorded as pending proposals, and the approved ontology only changes after review.

The same core is also specified for **Agy**, Google Antigravity CLI's executable, which can use Gemini models. The `oracle agy` adapter is planned in OpenSpec and is not available in this version.

## Requirements

- Linux with Node.js 22 or later and npm.
- Codex CLI installed and authenticated. The current integration was verified with `codex-cli 0.156.1`.
- `git` available on Linux.
- A project directory you can read and write. Codex runs in that real project, with no extra sandbox imposed by Oracle.

## Global installation on Linux

On this machine, version `0.2.0` was packed and installed globally into the nvm-managed Node.js 22. The `oracle` executable is on that environment's `PATH` and can be called from any directory. The installation uses a **copy of the package**, independent of this checkout.

To reproduce the installation from this repository, or to install your local changes:

```bash
cd /path/to/oracle
npm install
npm pack --pack-destination /tmp
npm install -g /tmp/oracle-ontology-harness-0.2.0.tgz
oracle --help
```

After changing Oracle's code, build and install a new tarball; the global installation does not track checkout changes. If `oracle` does not show up in a new terminal, activate the same Node.js version through nvm and check `npm prefix -g` and your `PATH`.

The package has **not been published to npm yet**. Once it is, `npm install -g oracle-ontology-harness` will install the executable globally, and `npx --yes oracle-ontology-harness --help` will run the published package on demand without a persistent global install. To use the local tarball without installing it globally, run `npx --yes --package=/tmp/oracle-ontology-harness-0.2.0.tgz oracle --help`.

## Preparing a codebase

Enter the directory of any project Codex should work on:

```bash
cd /path/to/my-codebase
oracle init
oracle domain add assets
```

This creates the following **inside the project itself**:

```text
<project>/
  .oracle/
    project.json                              # manifest: lists the domains
    domains/
      assets/
        ontology.jsonld                       # domain ontology (JSON-LD 1.1)
        shapes.ttl                            # verifiable rules (SHACL, Turtle)
```

**Where ontologies live (rule).** A domain ontology belongs to the project it refers to and lives in `<project>/.oracle/domains/<domain>/`. Never place one project's ontology inside the Oracle package, in another project, or in a global directory: each project loads its own. When you run `oracle codex`, the selected project must contain its own validated ontology — including when it is a working copy used in tests. The fixtures under the Oracle package's `test/fixtures/` are synthetic ontologies for unit tests only, not project ontologies.

**Format.** `ontology.jsonld` is JSON-LD 1.1 with `@context` and `@graph`; `shapes.ttl` is Turtle with SHACL Core constraints. Use local or embedded JSON-LD contexts — Oracle rejects remote contexts — and keep file references inside the project directory. A minimal `ontology.jsonld`:

```json
{
  "@context": {
    "ex": "urn:my-project:assets:",
    "oracle": "urn:oracle:ns:v1:",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#"
  },
  "@graph": [
    { "@id": "ex:Asset", "@type": "rdfs:Class", "rdfs:label": "Asset" },
    { "@id": "ex:AssetTransfer", "@type": "rdfs:Class", "rdfs:label": "Asset transfer" },
    { "@id": "ex:adequate-justification", "@type": "oracle:Policy",
      "oracle:governs": { "@id": "ex:AssetTransfer" },
      "oracle:requiresHumanReview": true,
      "rdfs:comment": "A transfer requires an adequate justification." }
  ]
}
```

A minimal `shapes.ttl`:

```turtle
@prefix ex: <urn:my-project:assets:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

ex:TransferShape a sh:NodeShape ;
  sh:targetClass ex:AssetTransfer ;
  sh:property [ sh:path ex:currentState ; sh:minCount 1 ;
    sh:message "A retired asset cannot be transferred." ] .
```

Repeat `oracle domain add <domain>` for every domain in the project. The `.oracle/project.json` manifest must list them all. Each domain needs business concepts identified by IRI and at least one applicable SHACL constraint **or** an active human-review policy. The skeleton produced by `domain add` is not ready for a session on its own.

These files **are the harness's governance configuration for that codebase**. Oracle validates every declared domain before allowing the agent, and uses the approved ontology snapshot for every decision. Changing the Oracle package does not create a project's ontology. See a complete example in the [pilot ontology](pilot/asset-management/.oracle/domains/ativos/ontology.jsonld) and [pilot shapes](pilot/asset-management/.oracle/domains/ativos/shapes.ttl).

Then validate and inspect:

```bash
oracle ontology validate
oracle ontology show assets
oracle ontology show assets urn:oracle:pilot:ativos:Ativo
```

To operate from another directory, add `--project /path/to/my-codebase`. Validation reports the domain, file, and rule that block readiness. The `show` command returns JSON with concepts, relations, policies, shapes, and source paths.

## Using with Codex

From the prepared codebase directory, run:

```bash
oracle doctor
oracle code base
```

`oracle codex` is an alias for `oracle code base`. On startup, Oracle **opens the real Codex TUI** — the same interface you already use — connected to a `codex app-server` that Oracle starts in the project itself. Oracle is a **harness that wraps Codex**: it injects the governance instructions, delivers the ontology context through the local MCP server, follows the session, measures the tokens spent on ontology verification, and raises alerts on violations. Codex runs normally in your project, with no extra sandbox imposed by Oracle.

Oracle **does not modify your Codex installation**: it uses a private `CODEX_HOME` with a copy of `auth.json` and never touches `~/.codex`. Type your requests in the TUI as usual, and exit with `/quit` or `Ctrl+C` so Oracle can finalize the session.

Each session runs in an **isolated Git worktree**. Oracle identifies the current branch and its HEAD, creates a session branch `oracle/session/<id>` and a real `git worktree` (under a private Oracle state directory, outside your project), and starts Codex there. Your main checkout stays untouched while the agent works, so you can keep using it. When the session ends, Oracle runs the project's gates in the worktree and **promotes the changes with Git** — fast-forward when the origin branch has not moved, or a rebase inside the worktree when it has. Promoted commits reach the origin branch; the temporary worktree and branch are then removed. Oracle never resets, cleans, or force-pushes your main checkout, and never runs `stash`/`reset`/`restore`/`clean` to make room for a session.

You can also use the alias and point at the project without entering its directory:

```bash
oracle codex --project /path/to/my-codebase
```

The command always uses the ontology from the selected directory. Each project needs its own `.oracle/project.json`, JSON-LD, and SHACL; a freshly initialized project is only ready after you define its concepts and rules and `oracle ontology validate` passes.

When the agent reports a conflict with the ontology (through the `oracle_report_conflict` tool), Oracle records an **ALERT** in `.oracle/local/alerts.jsonl` and, at the end of the session, asks for your decision:

- **Ontology respected** (no conflict reported): the changes are promoted to the origin branch.
- **Violation or uncertainty**: you can **approve the exception** (the changes are promoted) or **deny it**. If you deny it, Oracle **discards the session worktree and branch**; your main checkout never needed a rollback.

Oracle **does not answer** Codex's native approvals (for example, running `npm test`); those remain your decisions in the TUI.

## Token accounting

The harness kicks in **before** the agent implements anything: the context and the ontology tools are delivered up front, and the agent is instructed to consult the ontology before changing rules. Consulting early and blocking a wrong path avoids rework and reduces the total tokens spent with Codex.

At the end of the session, Oracle prints a summary with:

- input, output, cache, and reasoning tokens, plus the total;
- the number of ontology queries and reported conflicts.

The summary is also written to `.oracle/local/`, alongside the audit trail. Codex shows live token usage in its own TUI.

For source code, the link between a diff and RDF facts is partial: Oracle **does not claim that SHACL proved the code's behavior**. Review the diff and run your project's tests. Changes under `.oracle/` require their own editing and validation. Because Codex works in an isolated worktree, an intermediate or rejected change never reaches your main checkout; Oracle validates and promotes only after the session ends.

## Code quality

Before running the tests, the project goes through a quality gate:

```bash
npm run quality   # tsc --noEmit + Biome (lint)
npm test          # runs the gate (pretest) and then the tests
```

- `npm run check` — type checking with TypeScript.
- `npm run lint` — static analysis with [Biome](https://biomejs.dev) (configured in `biome.json`), the JavaScript/TypeScript counterpart to Ruff in Python.
- `npm run quality` — both of the above, run automatically before `npm test`.

## Benchmark: Oracle harness vs. plain Codex

The `benchmark/` directory measures the harness's token cost and governance effect against plain Codex, running the **same prompt** on clean copies of the project:

- **`sem-oracle`** — plain Codex (`codex exec --json`), without the harness.
- **`com-oracle`** — `oracle codex`, with the harness injecting context and consulting the ontology.

```bash
python3 -m venv --system-site-packages benchmark/.venv
BENCH_RUNS=10 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \
  benchmark/.venv/bin/python benchmark/run_benchmark.py
benchmark/.venv/bin/python benchmark/analyze.py
```

Each run is a **batch** under `benchmark/results/<timestamp>/` containing the numbered executions (`1..n`), the discarded warm-up, and its own artifacts: `charts/`, `stats.md`, `stats.json`, and `measurements.csv`. The methodology and best practices are documented in `benchmark/README.md`.

Result with the prompt the ontology **blocks** (10 runs per condition, `gpt-6-sol` at `low` effort):

| Condition | n | Mean tokens | Std. dev. | 95% CI | Blocks |
| --- | --- | --- | --- | --- | --- |
| Codex without Oracle | 10 | 256,673 | 103,601 | +/- 74,106 | 0/10 |
| Codex with Oracle harness | 10 | 85,804 | 10,894 | +/- 7,792 | 10/10 |

The harness blocked the ontology-violating prompt in 10/10 runs and cut the mean token cost by **170,869 tokens (-66.57%)** (paired Cohen's d_z = 1.74; Wilcoxon signed-rank p = 0.00195). Plain Codex applied the violating change in 10/10 runs. With an **adherent** prompt the difference is small, and the harness spends extra tokens on the ontology query; the payoff is largest when a request needs course correction before implementation.

## Pilot project

The codebase under [pilot/asset-management](pilot/asset-management) is an independent web application for asset transfer, retirement, responsible party, and location. Its ontology and SHACL are its own. You can verify both:

```bash
npm test --prefix pilot/asset-management
oracle ontology validate --project pilot/asset-management
```

The pilot server builds with `npm run build --prefix pilot/asset-management` and runs with `node pilot/asset-management/dist/server.js`. The API lists assets at `GET /assets` and accepts operations at `POST /assets/{id}/transfer`, `/retire`, `/responsible`, and `/location`.

The functional E2E test requires opening `oracle codex` in a persistent `tmux` or `herdr` session and asking the agent for code changes that are adherent and contrary to the ontology. The rule is defined in [AGENTS.md](AGENTS.md). The [first functional attempt](pilot/asset-management/evaluation/functional-e2e-2026-09-23.md) records the refusal before the first turn; the [round after unblocking](pilot/asset-management/evaluation/functional-e2e-2026-09-23-run.md) records both cases on clean copies. Direct HTTP tests of the pilot do not prove Oracle's governance.

## Project status

The ontology base, the decision core, the audit trail, the pilot, and the initial governed Codex session are runnable. Knowledge capture for review, Agy, and the A/B/C evaluation are still in progress, as tracked in [OpenSpec](openspec/changes/build-oracle-ontology-harness/tasks.md). The package is installed globally on this Linux host from a local tarball, but has not been published to npm.
