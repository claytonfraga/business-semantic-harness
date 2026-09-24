# Oracle harness no seu projeto: guia para autenticação

Este guia explica **o que você precisa escrever** para que o Oracle harness funcione em um software novo (exemplo: autenticação). O Oracle não adivinha o seu domínio: ele governa o agente a partir de uma **ontologia por projeto** que você declara. Sem esses arquivos, `oracle codex` recusa a sessão.

## 1. O que o harness exige (mínimo)

Para cada projeto:

1. Um diretório `.oracle/` na raiz do projeto.
2. Um manifesto `.oracle/project.json` com os domínios.
3. Para cada domínio, dois arquivos em `.oracle/domains/<dominio>/`:
   - `ontology.jsonld` — conceitos, relações e políticas (JSON-LD 1.1, com `@context` local ou embutido; o Oracle recusa contextos remotos).
   - `shapes.ttl` — regras verificáveis (SHACL Core, Turtle).
4. Cada domínio precisa de **ao menos um conceito de negócio** e de **ao menos uma restrição SHACL** ou **uma política de revisão humana ativa**.
5. A ontologia **pertence ao projeto**: vive em `.oracle/domains/<dominio>/` e não deve ser copiada para outro projeto ou para o pacote Oracle.
6. O projeto precisa ser um **repositório Git**: cada sessão roda em uma Git worktree isolada e o Oracle promove as alterações por Git ao final.

## 2. Estrutura de arquivos

```text
meu-servico-auth/
  .oracle/
    project.json
    domains/
      autenticacao/
        ontology.jsonld
        shapes.ttl
  src/
  test/
```

## 3. Passo a passo

```bash
cd /caminho/para/meu-servico-auth
oracle init                 # cria .oracle/project.json vazio
oracle domain add autenticacao   # cria o esqueleto do domínio
# edite ontology.jsonld e shapes.ttl (exemplos abaixo)
oracle ontology validate    # precisa retornar "Ontologia válida e pronta."
oracle ontology show autenticacao
oracle codex                # abre a TUI real do Codex governada pelo Oracle
```

Para apontar para outro projeto sem entrar na pasta:

```bash
oracle codex --project /caminho/para/meu-servico-auth
```

## 4. Exemplo completo para autenticação

### `.oracle/project.json`

```json
{
  "schemaVersion": 1,
  "projectId": "servico-auth",
  "domains": [
    {
      "id": "autenticacao",
      "version": "1.0.0",
      "baseIri": "urn:meu-servico:auth:",
      "ontology": "domains/autenticacao/ontology.jsonld",
      "shapes": "domains/autenticacao/shapes.ttl"
    }
  ]
}
```

### `.oracle/domains/autenticacao/ontology.jsonld`

```json
{
  "@context": {
    "auth": "urn:meu-servico:auth:",
    "oracle": "urn:oracle:ns:v1:",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  },
  "@graph": [
    { "@id": "auth:ontology", "@type": "oracle:Domain", "oracle:version": "1.0.0" },

    { "@id": "auth:Usuario", "@type": "rdfs:Class", "rdfs:label": "Usuário" },
    { "@id": "auth:Credencial", "@type": "rdfs:Class", "rdfs:label": "Credencial" },
    { "@id": "auth:Papel", "@type": "rdfs:Class", "rdfs:label": "Papel" },
    { "@id": "auth:Sessao", "@type": "rdfs:Class", "rdfs:label": "Sessão" },
    { "@id": "auth:Login", "@type": "rdfs:Class", "rdfs:label": "Login" },
    { "@id": "auth:RedefinicaoDeSenha", "@type": "rdfs:Class", "rdfs:label": "Redefinição de senha" },
    { "@id": "auth:AtivacaoDeMfa", "@type": "rdfs:Class", "rdfs:label": "Ativação de MFA" },
    { "@id": "auth:BloqueioDeConta", "@type": "rdfs:Class", "rdfs:label": "Bloqueio de conta" },

    { "@id": "auth:Ativa", "rdfs:label": "Ativa" },
    { "@id": "auth:Pendente", "rdfs:label": "Pendente" },
    { "@id": "auth:Bloqueada", "rdfs:label": "Bloqueada" },
    { "@id": "auth:SessaoAtiva", "rdfs:label": "Sessão ativa" },
    { "@id": "auth:SessaoExpirada", "rdfs:label": "Sessão expirada" },

    { "@id": "auth:temPapel", "@type": "rdf:Property", "rdfs:domain": { "@id": "auth:Usuario" }, "rdfs:range": { "@id": "auth:Papel" } },
    { "@id": "auth:temCredencial", "@type": "rdf:Property", "rdfs:domain": { "@id": "auth:Usuario" }, "rdfs:range": { "@id": "auth:Credencial" } },
    { "@id": "auth:estadoConta", "@type": "rdf:Property", "rdfs:comment": "Estado da conta antes da ação; Bloqueada é terminal para login." },
    { "@id": "auth:estadoSessao", "@type": "rdf:Property", "rdfs:comment": "Estado da sessão." },
    { "@id": "auth:mfaAtivo", "@type": "rdf:Property", "rdfs:comment": "Exige segundo fator quando verdadeiro." },
    { "@id": "auth:expiraEm", "@type": "rdf:Property", "rdfs:comment": "Instante de expiração da sessão." },
    { "@id": "auth:motivoBloqueio", "@type": "rdf:Property", "rdfs:comment": "Motivo obrigatório do bloqueio." },
    { "@id": "auth:verificacaoDeIdentidade", "@type": "rdf:Property", "rdfs:comment": "Evidência de verificação para redefinir senha." },

    {
      "@id": "auth:politica-bloqueio-conta",
      "@type": "oracle:Policy",
      "oracle:governs": { "@id": "auth:BloqueioDeConta" },
      "oracle:requiresHumanReview": true,
      "oracle:scope": "Bloqueio de conta de usuário",
      "oracle:reason": "O motivo e o impacto do bloqueio exigem julgamento contextual.",
      "rdfs:comment": "Todo bloqueio exige motivo adequado e revisão humana."
    },
    {
      "@id": "auth:politica-redefinicao-senha",
      "@type": "oracle:Policy",
      "oracle:governs": { "@id": "auth:RedefinicaoDeSenha" },
      "oracle:requiresHumanReview": true,
      "oracle:scope": "Redefinição de senha",
      "oracle:reason": "A força da verificação de identidade depende do contexto.",
      "rdfs:comment": "Redefinição de senha exige verificação de identidade adequada."
    }
  ]
}
```

### `.oracle/domains/autenticacao/shapes.ttl`

```turtle
@prefix auth: <urn:meu-servico:auth:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

auth:LoginShape a sh:NodeShape ;
  sh:targetClass auth:Login ;
  sh:property [
    sh:path auth:estadoConta ;
    sh:minCount 1 ;
    sh:in ( auth:Ativa auth:Pendente ) ;
    sh:message "Conta bloqueada não pode autenticar."
  ] ;
  sh:property [
    sh:path auth:temCredencial ;
    sh:minCount 1 ;
    sh:message "Login exige credencial."
  ] .

auth:MfaShape a sh:NodeShape ;
  sh:targetClass auth:AtivacaoDeMfa ;
  sh:property [
    sh:path auth:mfaAtivo ;
    sh:minCount 1 ;
    sh:hasValue true ;
    sh:message "Ativação de MFA exige mfaAtivo verdadeiro."
  ] .

auth:SessaoShape a sh:NodeShape ;
  sh:targetClass auth:Sessao ;
  sh:property [
    sh:path auth:expiraEm ;
    sh:minCount 1 ;
    sh:message "Sessão exige instante de expiração."
  ] ;
  sh:property [
    sh:path auth:estadoSessao ;
    sh:in ( auth:SessaoAtiva auth:SessaoExpirada ) ;
    sh:message "Estado de sessão inválido."
  ] .

auth:BloqueioShape a sh:NodeShape ;
  sh:targetClass auth:BloqueioDeConta ;
  sh:property [
    sh:path auth:estadoConta ;
    sh:in ( auth:Ativa auth:Pendente ) ;
    sh:message "Conta já bloqueada não pode ser bloqueada de novo."
  ] ;
  sh:property [
    sh:path auth:motivoBloqueio ;
    sh:minCount 1 ;
    sh:message "Bloqueio exige motivo."
  ] .

auth:RedefinicaoShape a sh:NodeShape ;
  sh:targetClass auth:RedefinicaoDeSenha ;
  sh:property [
    sh:path auth:verificacaoDeIdentidade ;
    sh:minCount 1 ;
    sh:message "Redefinição exige verificação de identidade."
  ] .
```

Valide com `oracle ontology validate`. O esqueleto de `oracle domain add` não passa sozinho: você precisa de conceitos e ao menos uma restrição ou política.

## 5. Como o harness age

- **Abre a TUI real do Codex** (`codex --remote`), governada por um `codex app-server` iniciado pelo Oracle. A instalação global do Codex **não é alterada** (usa `CODEX_HOME` privado).
- **Injeta contexto**: instruções de governança e o MCP local com `oracle_query_ontology`, `oracle_propose_patch` e `oracle_report_conflict`.
- **Consulta antes de mudar**: o agente deve consultar a ontologia antes de implementar.
- **Conflito**: se o pedido contrariar a ontologia, o agente chama `oracle_report_conflict`; o Oracle **registra um alerta** (`.oracle/local/alerts.jsonl`) e, ao final da sessão, pede decisão humana: aprovar a exceção ou **reverter** as alterações.
- **Isolamento por worktree**: cada sessão cria uma branch `oracle/session/<id>` e uma Git worktree própria (fora do projeto). O Codex trabalha só nela; o checkout principal permanece intacto. Por padrão o sandbox do Codex roda em `workspace-write` com a raiz gravável na worktree (pode ser desativado com `ORACLE_CODEX_SANDBOX=danger-full-access`). Ao final, o Oracle roda os gates na worktree e **promove as alterações por Git** (fast-forward, ou rebase na worktree se a branch de origem avançou). Se você negar uma exceção de ontologia, a worktree é descartada — nada a reverter no projeto principal.
- **Mede tokens**: ao final, imprime tokens de entrada/saída/total, consultas à ontologia e conflitos.

## 6. Checklist de prontidão

- [ ] `.oracle/project.json` declara todos os domínios com `id`, `version`, `baseIri`, `ontology` e `shapes`.
- [ ] Cada `ontology.jsonld` tem `@context` local/embutido (sem URL remota) e ao menos um conceito de negócio.
- [ ] Cada domínio tem ao menos uma restrição SHACL **ou** uma `oracle:Policy` com `oracle:requiresHumanReview` verdadeiro.
- [ ] `oracle ontology validate` retorna **"Ontologia válida e pronta."**
- [ ] A ontologia está dentro do projeto (não copiada de outro).
- [ ] Codex CLI instalado e autenticado (verificado com `codex-cli 0.156.1`).

## 7. Limitações a ter em mente

- SHACL valida **fatos modelados**, não a semântica de um diff de código; por isso a revisão humana continua necessária.
- A detecção de conflito depende de o agente relatar o conflito; uma violação não relatada pode passar.
- O harness não prova conformidade automática: ele consulta, alerta, mede e reverte quando você nega.
