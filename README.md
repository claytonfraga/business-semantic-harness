# Oracle para Codex

O Oracle usa a ontologia **do seu próprio projeto** para dar contexto ao Codex, verificar ações representáveis e pedir sua decisão quando houver conflito ou informação insuficiente. **A ontologia JSON-LD e as regras SHACL fazem parte do harness Oracle de cada projeto e de cada domínio**: ficam no `.oracle/` do codebase, são versionadas com esse projeto e são carregadas quando o Oracle abre uma sessão nele. O pacote global fornece o motor e o comando `oracle`; ele não substitui nem compartilha a ontologia de um projeto com outro. Descobertas do agente entram como propostas pendentes; a ontologia aprovada só muda após revisão.

O mesmo núcleo também está especificado para o **Agy**, executável do Google Antigravity CLI, que pode usar modelos Gemini. O adaptador `oracle agy` está planejado no OpenSpec e ainda não está disponível nesta versão.

## Requisitos

- Linux com Node.js 22 ou superior e npm.
- Codex CLI instalado e autenticado. A integração atual foi verificada com `codex-cli 0.156.1`.
- `git` disponível no Linux.
- Um diretório de projeto ao qual você tem acesso de leitura e escrita. O Codex roda nesse projeto real, sem sandbox adicional imposto pelo Oracle.

## Instalação global no Linux

Nesta máquina, a versão `0.2.0` foi empacotada e instalada globalmente no Node.js 22 gerenciado por nvm. O executável `oracle` está no `PATH` desse ambiente e pode ser chamado de qualquer pasta. A instalação usa uma **cópia do pacote**, independente deste checkout.

Para repetir a instalação a partir deste repositório ou instalar suas alterações locais:

```bash
cd /caminho/para/oracle
npm install
npm pack --pack-destination /tmp
npm install -g /tmp/oracle-ontology-harness-0.2.0.tgz
oracle --help
```

Após alterar o código do Oracle, gere e instale outro tarball; a instalação global não acompanha mudanças do checkout. Se `oracle` não aparecer em um novo terminal, ative a mesma versão do Node.js pelo nvm e confira `npm prefix -g` e seu `PATH`.

O pacote **ainda não foi publicado no npm**. Quando for publicado, `npm install -g oracle-ontology-harness` instalará o executável globalmente. `npx --yes oracle-ontology-harness --help` executará o pacote publicado sob demanda, sem instalação global persistente. Para usar o tarball local sem instalá-lo globalmente, execute `npx --yes --package=/tmp/oracle-ontology-harness-0.2.0.tgz oracle --help`.

## Preparar um codebase

Entre na pasta de qualquer projeto que o Codex deverá analisar:

```bash
cd /caminho/para/meu-codebase
oracle init
oracle domain add ativos
```

Isso cria, **dentro do próprio projeto**:

```text
<projeto>/
  .oracle/
    project.json                              # manifesto: lista os domínios
    domains/
      ativos/
        ontology.jsonld                       # ontologia do domínio (JSON-LD 1.1)
        shapes.ttl                            # regras verificáveis (SHACL, Turtle)
```

**Onde ficam as ontologias (regra).** A ontologia de um domínio pertence ao projeto a que se refere e vive em `<projeto>/.oracle/domains/<dominio>/`. Nunca coloque a ontologia de um projeto no pacote Oracle, em outro projeto ou em um diretório global: cada projeto carrega a sua. Ao rodar `oracle codex`, o projeto selecionado precisa conter a própria ontologia validada — inclusive quando ele for uma cópia de trabalho usada em testes. As fixtures em `test/fixtures/` do pacote Oracle são apenas ontologias sintéticas para testes unitários, não ontologias de projeto.

**Formato.** `ontology.jsonld` é JSON-LD 1.1 com `@context` e `@graph`; `shapes.ttl` é Turtle com restrições SHACL Core. Use contextos JSON-LD locais ou embutidos — o Oracle recusa contextos remotos — e mantenha as referências de arquivo dentro do diretório do projeto. Exemplo mínimo de `ontology.jsonld`:

```json
{
  "@context": {
    "ex": "urn:meu-projeto:ativos:",
    "oracle": "urn:oracle:ns:v1:",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#"
  },
  "@graph": [
    { "@id": "ex:Ativo", "@type": "rdfs:Class", "rdfs:label": "Ativo" },
    { "@id": "ex:TransferenciaAtivo", "@type": "rdfs:Class", "rdfs:label": "Transferência de ativo" },
    { "@id": "ex:justificativa-adequada", "@type": "oracle:Policy",
      "oracle:governs": { "@id": "ex:TransferenciaAtivo" },
      "oracle:requiresHumanReview": true,
      "rdfs:comment": "A justificativa da transferência deve ser adequada." }
  ]
}
```

Exemplo mínimo de `shapes.ttl`:

```turtle
@prefix ex: <urn:meu-projeto:ativos:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

ex:TransferenciaShape a sh:NodeShape ;
  sh:targetClass ex:TransferenciaAtivo ;
  sh:property [ sh:path ex:estadoAtual ; sh:minCount 1 ;
    sh:message "Ativo baixado não pode ser transferido." ] .
```

Repita `oracle domain add <dominio>` para cada domínio do projeto. O manifesto `.oracle/project.json` deve listar todos. Cada domínio precisa de conceitos de negócio identificados por IRI e de ao menos uma restrição SHACL aplicável **ou** política de revisão humana ativa. O esqueleto gerado por `domain add` ainda não está pronto para uma sessão.

Esses arquivos **são a configuração de governança do harness para esse codebase**. O Oracle valida todos os domínios declarados antes de permitir o agente e usa o retrato aprovado da ontologia em cada decisão. Alterar o pacote Oracle não cria a ontologia de um projeto. Veja um exemplo completo em [ontologia do piloto](pilot/asset-management/.oracle/domains/ativos/ontology.jsonld) e [shapes do piloto](pilot/asset-management/.oracle/domains/ativos/shapes.ttl).

Depois valide e consulte:

```bash
oracle ontology validate
oracle ontology show ativos
oracle ontology show ativos urn:oracle:pilot:ativos:Ativo
```

Para operar a partir de outra pasta, acrescente `--project /caminho/para/meu-codebase`. A validação aponta o domínio, arquivo e regra que impedem a prontidão. O comando `show` devolve JSON com conceitos, relações, políticas, shapes e caminhos de origem.

## Usar com Codex

Na pasta do codebase já preparado, execute:

```bash
oracle doctor
oracle code base
```

`oracle codex` é um alias de `oracle code base`. Ao iniciar, o Oracle **abre a TUI real do Codex** — a mesma interface que você já usa — conectada a um `codex app-server` iniciado pelo Oracle no próprio projeto. O Oracle é um **harness que envolve o Codex**: injeta as instruções de governança, entrega o contexto ontológico pelo MCP local, acompanha a sessão, mede os tokens gastos na verificação ontológica e alerta violações. O Codex opera normalmente no seu projeto, sem sandbox adicional imposto pelo Oracle.

O Oracle **não altera a instalação do Codex**: usa um `CODEX_HOME` privado com uma cópia do `auth.json` e não toca em `~/.codex`. Digite seus pedidos na TUI normalmente e encerre com `/quit` ou `Ctrl+C` para o Oracle consolidar a sessão.

Você também pode usar o alias e apontar para o projeto sem entrar na pasta dele:

```bash
oracle codex --project /caminho/para/meu-codebase
```

O comando sempre usa a ontologia da pasta selecionada. Cada projeto precisa do seu próprio `.oracle/project.json`, JSON-LD e SHACL; um projeto recém-inicializado só fica pronto depois que você definir seus conceitos e regras e `oracle ontology validate` passar.

Quando o agente relata conflito com a ontologia (ferramenta `oracle_report_conflict`), o Oracle registra um **ALERTA** em `.oracle/local/alerts.jsonl` e, ao final da sessão, pede sua decisão:

- **Ontologia respeitada** (nenhum conflito relatado): as alterações permanecem no projeto.
- **Violação ou incerteza**: você pode **aprovar a exceção** (as alterações permanecem) ou **negar**. Se negar, o Oracle **reverte** os arquivos alterados durante a sessão, a partir de um backup privado feito no início.

O Oracle **não responde** às aprovações nativas do Codex (por exemplo, rodar `npm test`); essas continuam sendo decisões suas na TUI.

## Medição de tokens

O harness é acionado **antes** de o agente implementar: o contexto e as ferramentas de ontologia são entregues no início, e o agente é instruído a consultar a ontologia antes de mudar regras. Consultar cedo e bloquear um caminho incorreto evita retrabalho e reduz o total de tokens gastos com o Codex.

Ao final da sessão, o Oracle imprime um resumo com:

- tokens de entrada, saída, cache e raciocínio, além do total;
- número de consultas à ontologia e de conflitos relatados.

O resumo também é gravado em `.oracle/local/` junto da trilha de auditoria. O Codex mostra o uso de tokens em tempo real na própria TUI.

Para código-fonte, a ligação entre o diff e os fatos RDF é parcial: o Oracle **não afirma que SHACL provou o comportamento do código**. Revise o diff e execute os testes do seu projeto. Mudanças em `.oracle/` exigem edição e validação próprias. Como o Codex roda no projeto real e sem sandbox adicional, trate a sessão como você trataria o Codex normalmente, com o Oracle medindo, alertando e podendo reverter ao final.

## Qualidade de código

Antes de rodar os testes, o projeto passa por um gate de qualidade:

```bash
npm run quality   # tsc --noEmit + Biome (lint)
npm test          # roda o gate (pretest) e depois os testes
```

- `npm run check` — verificação de tipos com TypeScript.
- `npm run lint` — análise estática com [Biome](https://biomejs.dev) (config em `biome.json`), equivalente ao papel do Ruff em Python.
- `npm run quality` — os dois acima, executado automaticamente antes de `npm test`.

## Benchmark: Oracle harness vs Codex direto

O diretório `benchmark/` mede tokens e governança do harness frente ao Codex direto, executando o **mesmo pedido** em cópias limpas do projeto:

- **`sem-oracle`** — Codex direto (`codex exec --json`), sem o harness.
- **`com-oracle`** — `oracle codex`, com o harness injetando contexto e consultando a ontologia.

```bash
python3 -m venv --system-site-packages benchmark/.venv
BENCH_RUNS=10 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \
  benchmark/.venv/bin/python benchmark/run_benchmark.py
benchmark/.venv/bin/python benchmark/analyze.py
```

Cada execução grava uma subpasta `benchmark/results/<data-hora-segundos>-<n>/` com prompt, metadados e artefatos. O agregado fica em `benchmark/results/stats.md`, `stats.json`, `measurements.csv` e `charts/` (gráficos 300 dpi). As boas práticas e a metodologia estão em `benchmark/README.md`.

Resultado com o pedido que a ontologia **bloqueia** (10 execuções por condição, `gpt-6-sol` com esforço `low`):

| Condição | n | Média tokens | Desvio padrão | IC 95% | Bloqueios |
| --- | --- | --- | --- | --- | --- |
| Codex sem Oracle | 10 | 315.491 | 78.553 | +/- 56.190 | 0/10 |
| Codex com Oracle harness | 10 | 81.613 | 8.889 | +/- 6.359 | 10/10 |

O harness bloqueou o pedido contrário à ontologia em 10/10 execuções e reduziu a média de tokens em **233.878 tokens (-74,13%)** (Cohen's d = -4,18). O Codex direto, sem o harness, aplicou a mudança contrária em 10/10. Com o pedido **aderente**, a diferença é pequena; o ganho do harness é maior quando o pedido exige correção de rumo antes da implementação.

## Projeto piloto

O codebase em [pilot/asset-management](pilot/asset-management) é uma aplicação web independente para transferência, baixa, responsável e localização de ativos. Sua ontologia e SHACL são próprios. Você pode verificar ambos:

```bash
npm test --prefix pilot/asset-management
oracle ontology validate --project pilot/asset-management
```

O servidor do piloto usa `npm run build --prefix pilot/asset-management` e `node pilot/asset-management/dist/server.js`. A API lista ativos em `GET /assets` e recebe operações em `POST /assets/{id}/transfer`, `/retire`, `/responsible` e `/location`.

O teste funcional E2E exige abrir `oracle codex` em uma sessão persistente `tmux` ou `herdr` e pedir ao agente mudanças de código aderentes e contrárias à ontologia. A regra está em [AGENTS.md](AGENTS.md). A [primeira tentativa funcional](pilot/asset-management/evaluation/functional-e2e-2026-09-23.md) registra a recusa antes do primeiro turno; a [rodada após o desbloqueio](pilot/asset-management/evaluation/functional-e2e-2026-09-23-run.md) registra os dois casos em cópias limpas. Testes HTTP diretos do piloto não comprovam a governança do Oracle.

## Estado do projeto

A base de ontologia, o núcleo de decisão, a trilha de auditoria, o piloto e a sessão governada inicial com Codex são executáveis. Captura de conhecimento para revisão, Agy e avaliação A/B/C continuam em desenvolvimento conforme [OpenSpec](openspec/changes/build-oracle-ontology-harness/tasks.md). O pacote está instalado globalmente neste Linux a partir de tarball local, mas não foi publicado no npm.
