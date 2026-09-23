# Oracle para Codex

O Oracle usa a ontologia **do seu próprio projeto** para dar contexto ao Codex, verificar ações representáveis e pedir sua decisão quando houver conflito ou informação insuficiente. Cada domínio do codebase tem um arquivo JSON-LD e um arquivo SHACL. Descobertas do agente entram como propostas pendentes; a ontologia aprovada só muda após revisão.

O mesmo núcleo também está especificado para o **Agy**, executável do Google Antigravity CLI, que pode usar modelos Gemini. O adaptador `oracle agy` está planejado no OpenSpec e ainda não está disponível nesta versão.

## Requisitos

- Linux com Node.js 22 ou superior e npm.
- Codex CLI instalado e autenticado. A integração em desenvolvimento foi verificada com `codex-cli 0.156.1`.
- Um diretório de projeto ao qual você tem acesso de leitura e escrita.

## Instalação e execução

O pacote expõe o executável `oracle`. Após a publicação no npm, você poderá escolher:

```bash
npm install -g oracle-ontology-harness
oracle --help
```

Ou executar sem instalação global:

```bash
npx --yes oracle-ontology-harness --help
```

`npx` baixa ou usa o pacote em cache para executar o comando; `npm install -g` é o caminho para manter o executável globalmente. O pacote **ainda não foi publicado**. Para testar este checkout no Linux:

```bash
git clone <url-deste-repositorio>
cd oracle
npm install
npm pack
npm install -g ./oracle-ontology-harness-0.1.0.tgz
oracle --help
```

Você também pode executar o tarball com `npx --yes --package=./oracle-ontology-harness-0.1.0.tgz oracle --help`. O pacote gera o JavaScript no `prepack` e instala `oracle` no `PATH`.

## Preparar um codebase

Entre na pasta do projeto que o Codex deverá analisar:

```bash
cd /caminho/para/meu-codebase
oracle init
oracle domain add ativos
```

Isso cria:

```text
.oracle/
  project.json
  domains/
    ativos/
      ontology.jsonld
      shapes.ttl
```

Repita `oracle domain add <dominio>` para cada domínio do projeto. O manifesto `.oracle/project.json` deve listar todos. Cada domínio precisa de conceitos de negócio identificados por IRI e de ao menos uma restrição SHACL aplicável **ou** política de revisão humana ativa. O esqueleto gerado por `domain add` ainda não está pronto para uma sessão.

Edite os dois arquivos do domínio. Use contextos JSON-LD locais ou embutidos; o Oracle recusa contextos remotos. As referências de arquivo devem permanecer dentro do diretório do projeto. Veja um exemplo completo em [ontologia do piloto](pilot/asset-management/.oracle/domains/ativos/ontology.jsonld) e [shapes do piloto](pilot/asset-management/.oracle/domains/ativos/shapes.ttl).

Depois valide e consulte:

```bash
oracle ontology validate
oracle ontology show ativos
oracle ontology show ativos urn:oracle:pilot:ativos:Ativo
```

Para operar a partir de outra pasta, acrescente `--project /caminho/para/meu-codebase`. A validação aponta o domínio, arquivo e regra que impedem a prontidão. O comando `show` devolve JSON com conceitos, relações, políticas, shapes e caminhos de origem.

## Usar com Codex

O comando planejado para a pasta do codebase é:

```bash
oracle doctor
oracle code base
```

`oracle codex` é um alias de `oracle code base`. **Nesta versão, `oracle code base` ainda recusa iniciar a sessão governada.** O Oracle já conversa com o `codex app-server`, inicia uma thread somente leitura com MCP obrigatório em teste e oferece consulta ontológica, mas ainda falta comprovar o bloqueio ou a mediação de todas as superfícies mutáveis do Codex. `oracle doctor` mostra `isolationVerified: false` e explica a recusa. Não trate o protótipo como proteção de ações de escrita.

Quando essa verificação estiver implementada, o fluxo será: o Codex recebe o projeto e domínios antes da primeira ação; consulta conceitos por MCP; uma ação representável é validada por SHACL; conflito, política textual ou fatos insuficientes geram uma pergunta com **Permitir uma vez** ou **Negar**. A autorização vale apenas para a ação, argumentos e versão da ontologia mostrados. Ações desconhecidas e falhas de auditoria são negadas.

## Projeto piloto

O codebase em [pilot/asset-management](pilot/asset-management) é uma aplicação web independente para transferência, baixa, responsável e localização de ativos. Sua ontologia e SHACL são próprios. Você pode verificar ambos:

```bash
npm test --prefix pilot/asset-management
oracle ontology validate --project pilot/asset-management
```

O servidor do piloto usa `npm run build --prefix pilot/asset-management` e `node pilot/asset-management/dist/server.js`. A API lista ativos em `GET /assets` e recebe operações em `POST /assets/{id}/transfer`, `/retire`, `/responsible` e `/location`.

O teste funcional E2E exige abrir `oracle codex` em uma sessão persistente `tmux` ou `herdr` e pedir ao agente mudanças de código aderentes e contrárias à ontologia. A regra está em [AGENTS.md](AGENTS.md), e a [primeira tentativa funcional](pilot/asset-management/evaluation/functional-e2e-2026-09-23.md) documenta o bloqueio encontrado antes do primeiro turno. Testes HTTP diretos do piloto não comprovam a governança do Oracle.

## Estado do projeto

A base de ontologia, o núcleo de decisão, a trilha de auditoria e o piloto são executáveis. A integração governada com Codex, a revisão de propostas e a avaliação A/B/C ainda estão em desenvolvimento conforme [OpenSpec](openspec/changes/build-oracle-ontology-harness/tasks.md). Nenhum pacote foi publicado no npm.
