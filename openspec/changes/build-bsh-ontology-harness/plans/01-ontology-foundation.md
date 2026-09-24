# BSH Ontology Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um CLI TypeScript que cria, carrega, valida e consulta ontologias JSON-LD/SHACL por projeto e domínio, sem iniciar agentes.

**Architecture:** Um carregador isola resolução de caminhos e manifesto; um módulo RDF converte JSON-LD e Turtle em grafos; um validador aplica integridade e prontidão; o CLI só formata seus resultados. Os módulos não dependem do Codex.

**Tech Stack:** Node.js 22, TypeScript estrito, teste nativo `node:test`, `jsonld`, `n3` e um validador SHACL compatível com RDF/JS. Fixar versões no lockfile no início da execução.

**Spec:** `openspec/changes/build-business-semantic-harness/specs/project-onboarding/spec.md` e `specs/domain-ontology/spec.md`; detalhes em `design.md` e rastreamento em `tasks.md` itens 1.1–2.3.

## Global Constraints

- Todo comando de terminal usado durante a implementação usa `/usr/bin/rtk` conforme as instruções do projeto.
- Cada projeto possui `.bsh/project.json`; cada domínio declarado possui `ontology.jsonld` e `shapes.ttl` próprios.
- O carregador não busca contextos JSON-LD remotos nem permite caminhos fora do projeto; erro de referência é explícito.
- `bsh codex` não inicia sem todos os domínios estruturalmente íntegros e prontos.
- O CLI escreve artefatos aprovados apenas por comando explícito e não sobrescreve arquivos existentes.
- Requisitos mudam primeiro nos specs OpenSpec; rodar `openspec validate build-business-semantic-harness --strict --no-interactive` depois de qualquer alteração.
- Inicializar Git no diretório BSH antes da primeira tarefa de código e registrar a especificação como linha de base; depois fazer um commit atômico por tarefa.

## Review Focus

| Entrada ou falha | Comportamento esperado | Tarefa dona do teste |
| --- | --- | --- |
| Link simbólico aponta para fora do projeto | Rejeitar antes de ler | 2 |
| Contexto JSON-LD remoto | Rejeitar sem fazer requisição de rede | 4 |
| Mesmo IRI definido de modo incompatível em dois domínios | Diagnóstico com ambas as origens | 5 |
| Shape parseável mas sem regra ativa | Domínio não está pronto | 5 |
| Criação repetida de domínio | Preservar arquivos existentes | 3 |

## File Map

| Arquivo | Responsabilidade |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json` | CLI, dependências e gates de build/teste |
| `src/cli.ts` | Despacho de `init`, `domain add`, `ontology validate/show` e mensagens de erro |
| `src/project/manifest.ts` | Tipos, parse e validação do manifesto |
| `src/project/paths.ts` | Diretório canônico e resolução segura de caminhos |
| `src/project/scaffold.ts` | Criação sem sobrescrita de projeto e domínio |
| `src/ontology/rdf.ts` | Parse de JSON-LD e Turtle para RDF/JS, sem rede |
| `src/ontology/validate.ts` | Integridade, prontidão e relatório SHACL |
| `src/ontology/query.ts` | Consulta por domínio e IRI com origem |
| `src/vocabulary/bsh.ts` | IRIs e versão do vocabulário BSH |
| `test/project/*.test.ts`, `test/ontology/*.test.ts`, `test/cli.test.ts` | Testes por comportamento dos specs |

## Task 1: Scaffold executável — OpenSpec 1.1

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `src/cli.ts`, `test/cli.test.ts`, `.gitignore`.

**Interfaces:** produzir `main(argv: string[]): Promise<number>` em `src/cli.ts`; todos os comandos posteriores entram por essa função. A primeira versão mostra ajuda e código 2 para comando desconhecido.

- [ ] **Step 1:** Executar `/usr/bin/rtk git init` se a pasta ainda não for um repositório e registrar os artefatos OpenSpec como linha de base; escrever teste que chama `main(['--help'])`, captura a saída e exige `bsh`, `init`, `domain`, `ontology`; comando desconhecido deve retornar 2.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falha porque o CLI ainda não existe.
- [ ] **Step 3:** Criar pacote ESM com scripts `build: tsc`, `check: tsc --noEmit`, `test: npm run build && node --test`; implementar despachante mínimo e `.gitignore` para `dist/`, `node_modules/` e `.bsh/local/`.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm run check`, `/usr/bin/rtk npm test` e `/usr/bin/rtk npm run build`; exigir saída 0.
- [ ] **Step 5:** Marcar 1.1 em `tasks.md` e fazer commit atômico da tarefa.

```ts
export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('bsh: init | domain add | ontology validate | ontology show\n');
    return 0;
  }
  process.stderr.write('Comando desconhecido. Use bsh --help.\n');
  return 2;
}
```

## Task 2: Manifesto e fronteira do projeto — OpenSpec 2.1

**Files:** `src/project/manifest.ts`, `src/project/paths.ts`, `test/project/manifest.test.ts`, `test/project/paths.test.ts`.

**Interfaces:** `loadManifest(projectRoot: string): Promise<ProjectManifest>` e `resolveProjectFile(root: string, relative: string): Promise<string>`; `ProjectManifest` contém `schemaVersion`, `projectId` e `domains[]` com `id`, `version`, `baseIri`, `ontology`, `shapes`.

- [ ] **Step 1:** Criar fixtures temporárias para manifesto com dois domínios, manifesto ausente, IDs duplicados, `../` e link simbólico externo; os dois últimos devem falhar antes de abrir o arquivo alvo.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falhas esperadas.
- [ ] **Step 3:** Validar campos, unicidade, versão suportada e caminhos relativos; usar `realpath` no projeto e nos arquivos existentes e exigir que cada destino permaneça abaixo da raiz canônica.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm test` e `/usr/bin/rtk npm run check`; exigir saída 0 e diagnósticos com domínio/caminho.
- [ ] **Step 5:** Marcar 2.1 em `tasks.md` e fazer commit atômico da tarefa.

```ts
export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  domains: Array<{
    id: string; version: string; baseIri: string;
    ontology: string; shapes: string;
  }>;
}
```

## Task 3: Autoria inicial — OpenSpec 1.3

**Files:** `src/project/scaffold.ts`, `src/cli.ts`, `test/project/scaffold.test.ts`, `test/cli.test.ts`.

**Interfaces:** `initProject(root: string): Promise<void>` e `addDomain(root: string, id: string): Promise<void>`; usam o manifesto da tarefa 2. Geram esqueleto parseável, ainda não pronto para sessão.

- [ ] **Step 1:** Testar `bsh init` em pasta vazia, `bsh domain add ativos`, tentativa repetida e preservação byte a byte dos arquivos existentes.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falha.
- [ ] **Step 3:** Gerar manifesto e arquivos JSON-LD/Turtle mínimos com IRIs base locais, mensagens que expliquem a falta de conceitos/regras e escrita exclusiva (`wx`) para evitar sobrescrita.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm test` e `/usr/bin/rtk npm run check`; exigir saída 0.
- [ ] **Step 5:** Marcar 1.3 em `tasks.md` e fazer commit atômico da tarefa.

## Task 4: Conversão RDF sem rede — OpenSpec 1.2 e parte de 2.2

**Files:** `src/ontology/rdf.ts`, `src/vocabulary/bsh.ts`, `test/ontology/rdf.test.ts`, `test/fixtures/ativos/ontology.jsonld`, `test/fixtures/ativos/shapes.ttl`.

**Interfaces:** `parseOntology(jsonText: string): Promise<Store>` e `parseShapes(turtleText: string): Store`, onde `Store` é o conjunto RDF/JS usado pelo validador posterior.

- [ ] **Step 1:** Testar classe `Ativo`, propriedade de relação, documento malformado, contexto remoto e Turtle inválido. Uma tentativa de contexto remoto deve falhar sem tráfego de rede.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falhas esperadas.
- [ ] **Step 3:** Usar `jsonld.toRDF(document, {format: 'application/n-quads', documentLoader: rejectRemoteContext})`, onde `rejectRemoteContext(url)` lança erro para todo contexto remoto; usar `N3.Parser` em modo N-Quads/Turtle estrito e `N3.Store`.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm test` e `/usr/bin/rtk npm run check`; exigir saída 0.
- [ ] **Step 5:** Marcar 1.2 em `tasks.md`; fazer commit atômico da tarefa. O item 2.2 só é concluído na tarefa 5.

## Task 5: Integridade, SHACL e prontidão — OpenSpec 2.2

**Files:** `src/ontology/validate.ts`, `test/ontology/validate.test.ts`, `test/fixtures/ativos/valid-action.ttl`, `test/fixtures/ativos/invalid-action.ttl`.

**Interfaces:** `validateProject(root: string): Promise<ValidationReport>`; `ValidationReport` inclui `ok`, `ready`, `issues[]` com `domain`, `file`, `rule`, `message`, `severity`.

- [ ] **Step 1:** Testar dois domínios íntegros, um ausente, um esqueleto sem conceito/regra, IRI incompatível entre domínios, violação SHACL e versão futura; o relatório identifica origem e motivo.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falhas esperadas.
- [ ] **Step 3:** Validar integridade do manifesto/grafos, usar biblioteca SHACL RDF/JS para shapes e instâncias, e computar prontidão somente após encontrar conceito de negócio e regra ativa em cada domínio.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm test` e `/usr/bin/rtk npm run check`; exigir saída 0.
- [ ] **Step 5:** Marcar 2.2 em `tasks.md` e fazer commit atômico da tarefa.

## Task 6: CLI de validação e consulta — OpenSpec 2.3

**Files:** `src/ontology/query.ts`, `src/cli.ts`, `test/ontology/query.test.ts`, `test/cli.test.ts`.

**Interfaces:** `queryOntology(root: string, domainId: string, iri?: string): Promise<QueryResult>`; retorna definição, relações, regras e caminhos de origem. CLI oferece `ontology validate` e `ontology show` com `--project`.

- [ ] **Step 1:** Testar consulta de `Ativo`, IRI ausente, domínio inexistente, validação de projeto incompleto e saída de sucesso para projeto completo.
- [ ] **Step 2:** Executar `/usr/bin/rtk npm test` e confirmar falhas esperadas.
- [ ] **Step 3:** Projetar o grafo em resposta textual com IRIs e origem, conectar os comandos ao carregador/validador e retornar código diferente de zero em falha.
- [ ] **Step 4:** Executar `/usr/bin/rtk npm run check`, `/usr/bin/rtk npm test`, `/usr/bin/rtk npm run build` e `/usr/bin/rtk openspec validate build-business-semantic-harness --strict --no-interactive`; exigir saída 0.
- [ ] **Step 5:** Marcar 2.3 em `tasks.md` e fazer commit atômico da tarefa.

## Handoff

Depois das seis tarefas, um projeto externo com dois domínios deve poder ser criado, validado e consultado sem Codex. O plano da etapa 2 parte das interfaces realmente entregues aqui e cobre `tasks.md` 3.1–3.3. Implementação e commits aguardam a revisão deste plano conforme a skill de planejamento.
