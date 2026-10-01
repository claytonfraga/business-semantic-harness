# Business Semantic Harness (BSH)

[![CI](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/business-semantic-harness.svg)](https://www.npmjs.com/package/business-semantic-harness)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Install with npx](https://img.shields.io/badge/npx-business--semantic--harness-informational.svg)](https://www.npmjs.com/package/business-semantic-harness)

The **Business Semantic Harness (BSH)** is an autonomous, ontology-governed AI software engineering client with direct **OpenRouter integration**. 

BSH guarantees that AI coding models modify codebases **without violating business rules and domain invariants**. Instead of relying on prompt instructions or model self-discipline, BSH enforces domain rules deterministically using formal W3C RDF/OWL ontologies and SHACL constraint shapes stored directly inside your repository.

---

## Why BSH?

Modern AI coding agents excel at syntactic tasks (writing boilerplate, refactoring functions, generating tests) but frequently suffer from **semantic hallucinations** — making unauthorized state transitions, bypassing corporate policies, omitting mandatory compliance fields, or modifying data in invalid lifecycle states.

BSH implements a **multi-layer semantic defense** that governs agent execution from prompt ingestion to final branch promotion:

1. **Pre-flight Prompt Guard**: Detects and highlights violating intents at prompt capture time, prompting the user with an explicit confirmation gate before any LLM tokens are consumed.
2. **Ephemeral Worktree Sandboxing**: Every session executes inside an isolated Git worktree (`bsh/session/<id>`). The developer's primary working directory and main Git branch remain 100% clean and untouched.
3. **Autonomous Scoped Tooling**: The model inspects and edits code through sandboxed workspace tools (`read_file`, `write_file`, `replace_file_content`, `list_directory`, `run_bash_command`) with strict path guards.
4. **Independent Semantic Gate**: Validates proposed code diffs against domain RDF facts and SHACL constraint shapes (`shapes.ttl`) using a local validation engine before promotion.
5. **Deterministic Promotion**: Conforming changes are cleanly promoted to the primary Git branch; non-conforming changes are strictly blocked with auditable violation reports.

---

## Quick Start

### 1. Run Instantly with `npx` (No Installation Required)

You can launch and run BSH in any repository immediately without prior global installation:

```bash
# Launch interactive governed session in your current project:
npx business-semantic-harness

# Pre-select domain and model directly:
npx business-semantic-harness --domain assets --model deepseek/deepseek-v4.1-flash

# Run against any target project path:
npx business-semantic-harness --project /path/to/my-project
```

### 2. Global Installation via npm

If you prefer having the `bsh` command available globally in your PATH:

```bash
npm install -g business-semantic-harness

# Once installed, launch with:
bsh

# View CLI options:
bsh --help
```

### 3. Build from Source

```bash
git clone https://github.com/claytonfraga/business-semantic-harness.git
cd business-semantic-harness
npm install
npm run build
npm link
```

---

## Configuration & Authentication

BSH connects directly to [OpenRouter](https://openrouter.ai), supporting hundreds of frontier and open models (DeepSeek V3/R1, Claude 3.5 Sonnet, GPT-4o, Qwen 2.5 Coder, Llama 3.3, Gemini 2.0).

### Method A: Web Browser OAuth (PKCE) — Zero Disk Storage

If launched without an API key, BSH offers browser-based authentication:
- Select **Web Browser Login (OAuth PKCE)** on the initial prompt.
- BSH generates a cryptographic code challenge and opens OpenRouter's authorization page in your browser.
- The authorization code is exchanged for an ephemeral session key stored strictly in memory.
- No secrets or `.env` files are written to disk.

### Method B: Environment Variable or `.env` File

Provide your OpenRouter API key via environment variable or in a local `.env` file:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Optional defaults:
BSH_DEFAULT_MODEL=deepseek/deepseek-v4.1-flash
BSH_DEFAULT_DOMAIN=assets
BSH_CONFIRM_PROMPT_VIOLATIONS=true
```

---

## Setting Up Domain Governance in a Project

To equip any repository with business ontology governance, initialize the BSH structure:

```bash
cd /path/to/my-project

# Initialize BSH configuration:
bsh init

# Add a domain governance module:
bsh domain add assets
```

This creates the canonical governance directory inside your repository:

```text
<project>/
└── .bsh/
    ├── project.json                      # Project manifest listing declared domains
    └── domains/
        └── assets/
            ├── ontology.jsonld           # OWL/RDF domain vocabulary (classes, properties, states)
            └── shapes.ttl                # Verifiable business rules (SHACL Core & SPARQL)
```

### 1. Defining Business Concepts (`ontology.jsonld`)

Declare business entities, lifecycle states, and valid relationships:

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
    { "@id": "ex:AssetTransfer", "@type": "rdfs:Class", "rdfs:label": "Asset Transfer" },
    { "@id": "ex:Available", "rdfs:label": "Available" },
    { "@id": "ex:InOperation", "rdfs:label": "In Operation" },
    { "@id": "ex:Retired", "rdfs:label": "Retired" },
    { "@id": "ex:currentState", "@type": "rdf:Property" },
    { "@id": "ex:newResponsible", "@type": "rdf:Property" }
  ]
}
```

### 2. Defining Verifiable Invariants (`shapes.ttl`)

Define SHACL shape constraints that candidate code changes must satisfy:

```turtle
@prefix ex: <urn:my-project:assets:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

ex:TransferShape a sh:NodeShape ;
  sh:targetClass ex:AssetTransfer ;
  sh:property [
    sh:path ex:currentState ;
    sh:minCount 1 ;
    sh:in ( ex:Available ex:InOperation ) ;
    sh:message "A retired asset cannot be transferred."
  ] ;
  sh:property [
    sh:path ex:newResponsible ;
    sh:minCount 1 ;
    sh:message "An asset transfer requires a designated new responsible party."
  ] .
```

### 3. Validating Ontologies & Rules

Before opening an interactive session, validate your domain files for syntactical and logical integrity:

```bash
bsh ontology validate
bsh ontology show assets
```

---

## Interactive Session Commands

During an interactive session, the following slash commands are available:

| Command | Action |
|---|---|
| `/model [query]` | Search and dynamically switch active OpenRouter models (e.g. `/model gpt` or `/model claude`). Safe cancel (`q`) preserves the current model. |
| `/domain` | Open the interactive modal to switch between declared project domains. |
| `/settings` | Open the preferences modal to toggle pre-flight prompt violation confirmation (`ON`/`OFF`). |
| `/rules` | Inspect active SHACL shapes and business constraints for the current domain. |
| `/affinity` | Run an automated concept affinity check between active ontology terms and codebase tokens. |
| `/diff` | Review session code diff against the origin commit and trigger Semantic Gate validation. |
| `/governed` | Re-enable ontology governance harness and activate SHACL constraints. |
| `/ungoverned` | Temporarily operate in unconstrained mode (bypass semantic validation). |
| `/clear` | Clear the chat feed and refresh the terminal display. |
| `/help` | Display command summary and shortcuts. |
| `/exit` | Discard or clean up temporary session worktree and exit. |

---

## Domain Affinity Engine

To prevent mismatched governance (e.g. applying banking shapes to a graphic utility), BSH computes semantic affinity between domain ontology concepts and the project codebase:

- **Aligned**: When ontology concepts match codebase identifiers, BSH displays `[*] GOVERNED` and enforces SHACL constraints.
- **Mismatch**: If concept overlap is low, BSH alerts the user with `[!] DOMAIN MISMATCH`, explaining the lack of affinity and prompting the user to switch domain (`/domain`) or operate unconstrained (`/ungoverned`).

---

## Code Quality & CI Verification

BSH maintains strict engineering standards:

```bash
# Typecheck + Lint:
npm run quality

# Unit test suite:
npm test

# End-to-End test suite:
npm run test:e2e
```

---

## License

[Apache License 2.0](LICENSE) © Clayton Fraga Filho
