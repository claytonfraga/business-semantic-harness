# Business Semantic Harness (BSH)

[![CI](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/claytonfraga/business-semantic-harness/actions/workflows/ci.yml)

The **Business Semantic Harness (BSH)** is an autonomous, ontology-governed coding agent client featuring a native **OpenRouter integration** and a modern, high-performance **Terminal User Interface (TUI)** inspired by OpenTUI.

BSH lets AI models modify your codebase **without breaking your business rules**. You describe your business domain once — its entities, states, and business invariants — as a verifiable model (JSON-LD ontology and SHACL constraint shapes) that lives directly inside your repository. Whenever you interact with a coding model through BSH, the harness validates proposed codebase changes against that model **on its own**. It never relies on the model to "remember" or self-police rules: if a proposed change violates a business constraint, BSH blocks promotion and explains why; if the change conforms, it promotes it cleanly to your Git branch.

---

## Key Highlights

- **Direct OpenRouter Client**: Connects directly to [OpenRouter](https://openrouter.ai), supporting hundreds of models (DeepSeek V3/R1, Claude 3.5 Sonnet, GPT-4o, Qwen 2.5 Coder, Llama 3.3, Gemini, etc.) with streaming completions and native function calling. No external CLI wrappers or third-party agent binaries (Codex, Agy, or OpenCode) are required.
- **Interactive OpenTUI-Inspired Terminal Interface**: 100% English interactive TUI with a live status header, syntax-highlighted diffs, tool execution logs, and searchable model and domain pickers.
- **Interactive Domain & SHACL Rules Selector**: Select which domain ontology and SHACL ruleset under `.bsh/domains/` will govern the coding session.
- **Autonomous Tool Execution**: The model is equipped with workspace tools (`read_file`, `write_file`, `replace_file_content`, `list_directory`, `run_bash_command`) strictly scoped to the project.
- **Guaranteed Workspace Isolation**: Every session executes inside an isolated Git worktree (`bsh/session/<id>`). Your primary working directory and branch remain completely clean and untouched until you explicitly promote an approved change.
- **Independent Semantic Gate**: Validates proposed code diffs against RDF domain facts and SHACL shapes (`shapes.ttl`) using a local SHACL engine before promotion.

---

## Requirements

- **Operating System**: Linux, macOS, or WSL2.
- **Node.js**: Version 22 or later (`node >= 22`).
- **Git**: Installed and available in PATH (sessions run in Git worktrees).
- **OpenRouter API Key**: A valid API key from [OpenRouter](https://openrouter.ai/keys).

---

## Installation

### From Source

```bash
git clone https://github.com/claytonfraga/business-semantic-harness.git
cd business-semantic-harness
npm install
npm run build
npm link
```

### Global Install via Tarball

```bash
npm pack --pack-destination /tmp
npm install -g /tmp/business-semantic-harness-0.2.1.tgz
bsh --help
```

---

## Configuration & Authentication

### 1. Setting up your OpenRouter API Key

BSH loads your OpenRouter API key automatically from a `.env` file in your project or from the environment:

Create or edit `.env` in your project root:
```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key-here
# Optional defaults:
BSH_DEFAULT_MODEL=deepseek/deepseek-chat
BSH_DEFAULT_DOMAIN=ativos
```

> **Security Note:** The `.env` file is strictly listed in `.gitignore` and saved with restricted file permissions (`0o600`). BSH never prints or leaks your API key in logs or telemetry.

### 2. First-Run Interactive Prompt

If you run `bsh` without an existing `.env` file or environment variable, BSH will display a secure prompt in the terminal asking for your key, test it against OpenRouter (`/auth/key`), and automatically save it to your local `.env`.

---

## Running BSH (Interactive TUI)

Navigate to any Git project containing `.bsh/` (or run in any project):

```bash
cd /path/to/my-project

# Launch interactive governed session:
bsh

# Or preselect model and domain:
bsh --model deepseek/deepseek-chat --domain ativos

# Or run from another directory:
bsh --project /path/to/my-project
```

### The TUI Layout

When BSH starts, it opens the interactive terminal interface:

```text
┌─ BSH [Business Semantic Harness] ─────────────────────────── [● GOVERNED] ─┐
│ Model: deepseek/deepseek-chat   Domain: ativos (SHACL active)   Tokens: 1,420 │
├─────────────────────────────────────────────────────────────────────────────┤
│ [User] Add an endpoint to transfer assets in 'In Operation' state.          │
│                                                                             │
│ [BSH Agent]                                                                 │
│ Inspecting asset repository and checking domain business rules...           │
│                                                                             │
│ ⚙ Tool Invocation: read_file({"path":"src/domain/asset.ts"})                │
│ ↳ Result: Read 84 lines.                                                    │
│                                                                             │
│ ⚙ Tool Invocation: replace_file_content({"path":"src/domain/asset.ts", ...}) │
│ ↳ Result: Successfully replaced target content in src/domain/asset.ts       │
│                                                                             │
│ 🛡 Semantic Gate: CONFORMING (All SHACL constraints satisfied)              │
├─────────────────────────────────────────────────────────────────────────────┤
│ > [Type your prompt here...]                                                │
│ [Ctrl+M] Model  [Ctrl+D] Domain/SHACL  [Ctrl+G] Diff/Gate  [Ctrl+C] Exit    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts & Slash Commands

| Command / Shortcut | Action |
|---|---|
| `[Ctrl+M]` or `/model` | Open the **Model Selector modal** to browse or search OpenRouter models. |
| `[Ctrl+D]` or `/domain` | Open the **Domain & SHACL Selector modal** to switch active ontology governance. |
| `[Ctrl+G]` or `/diff` | Open the **Diff Review & Semantic Gate** modal to review diffs and promote changes. |
| `[Ctrl+L]` or `/clear` | Clear the chat viewport and refresh the status header. |
| `/help` | Print available commands and keyboard shortcuts in English. |
| `/exit` or `/quit` | Clean up the session worktree and exit BSH. |

---

## Preparing a Project for Governance

To equip any repository with business ontology governance:

```bash
cd /path/to/my-project
bsh init
bsh domain add assets
```

This creates the project-local governance configuration:

```text
<project>/
  .bsh/
    project.json                              # Project manifest listing domains
    domains/
      assets/
        ontology.jsonld                       # Domain ontology (JSON-LD 1.1)
        shapes.ttl                            # Verifiable business rules (SHACL Core & SPARQL)
```

### 1. Defining Business Concepts (`ontology.jsonld`)

`ontology.jsonld` defines your entities, valid state transitions, and properties:

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

### 2. Defining Verifiable Rules (`shapes.ttl`)

`shapes.ttl` defines the invariants that candidate changes must satisfy:

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

```bash
bsh ontology validate
bsh ontology show assets
```

`bsh ontology validate` ensures there are no broken IRIs, missing classes, or syntax errors before a session starts.

---

## How Semantic Governance Operates

1. **Isolation**: When BSH opens, it provisions a Git worktree (`bsh/session/<id>`).
2. **Autonomous Tool Calls**: The model reads and edits files within this worktree.
3. **Continuous Semantic Interception**: When changes are proposed or `/diff` is invoked, BSH checks the extracted RDF facts against the active domain's SHACL shapes.
4. **Promotion Decision**:
   - **Conforming**: If all rules pass, the TUI displays a colored diff and prompts `Promote changes to primary branch? [y/N]`.
   - **Violation**: If any rule fails, promotion is blocked, the exact violation message is displayed in English, and the model is prompted to self-correct.
5. **Clean Teardown**: Upon exit (`/exit`), BSH removes the temporary worktree and branch, leaving your repository in a clean state.

---

## Code Quality & Testing

BSH enforces strict quality gates:

```bash
# Typecheck + Biome linting:
npm run quality

# Run all unit and integration test suites:
npm test
```

---

## License

MIT © Clayton Fraga Filho
