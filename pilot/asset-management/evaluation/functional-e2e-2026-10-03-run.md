# Teste Funcional E2E e Jornada 16 — Reconstrução OpenTUI (2026-10-03)

## Escopo e Ambiente

- **Batch ID**: `batch-20261003-opentui`
- **Data**: 2026-10-03
- **Branch**: `feature/opentui-component-tui-rewrite`
- **Produto**: Binário global `bsh` (`0.2.11-beta`), empacotado via `npm pack` e instalado globalmente via `npm install -g business-semantic-harness-0.2.11-beta.tgz`.
- **Runtime**: Node.js v22.19.0 (CLI launcher) com runtime Bun v1.4.2 embutido no pacote (`@opentui/core` v0.5.14).
- **Projeto Piloto**: Cópia limpa em `/tmp/bsh-pilot-jornada-16` derivada de `pilot/asset-management`.
- **Sessão Persistente**: Sessão `tmux` (`bsh-jornada-16`).
- **Especificações de Referência**: `openspec/specs/opentui-component-tui.feature`, `test/features/journeys/jornada-16-reconstrucao-opentui.feature`.

---

## 1. Validação Prévia da Ontologia

Antes de qualquer turno ou interação, a ontologia do domínio `ativos` (`ontology.jsonld` e `shapes.ttl`) da cópia limpa foi validada com o comando oficial:

```bash
bsh --project /tmp/bsh-pilot-jornada-16 ontology validate
```

- **Resultado Observado**: `Ontologia válida e pronta.` (código de saída 0).
- **Status**: Aprovado antes do primeiro turno.

---

## 2. Casos de Teste e Cenários Executados

| Cenário / Requisito | Procedimento / Prompt | Comportamento Esperado | Resultado Observado | Status |
| --- | --- | --- | --- | --- |
| **Cenário 1: Paleta e Seletores com Cancelamento Seguro**<br>`@BSH-OPENTUI-005`<br>`@BSH-OPENTUI-014`<br>`@BSH-OPENTUI-015` | 1. Prompt vazio -> digitação de `/`<br>2. Navegação com setas (Down) e Tab<br>3. Filtro em tempo real com `ex`<br>4. Cancelamento via `Escape`<br>5. Abertura e cancelamento de `/model`, `/domain`, `/skills` | Paleta suspensa exibida acima do prompt (<=72 colunas), rolagem por janela `(1-5 de 14) • ↑/↓ scroll`, cores distintas GitHub Dark Dimmed, ponteiro `❯`. Ao teclar Escape, fecha sem despachar e restaura o prompt limpo. | Paleta abriu instantaneamente sobre o prompt, destacou `/model`, navegou com cores específicas por comando, filtrou `/exit` em vermelho carmesim e ao teclar `Escape` restaurou o prompt sem despacho. Seletores `/model`, `/domain` e `/skills` foram inspecionados e cancelados mantendo foco e seleções ativas. | **Passou** |
| **Cenário 2: Streaming, Fila FIFO e Responsividade**<br>`@BSH-OPENTUI-006`<br>`@BSH-OPENTUI-007`<br>`@BSH-OPENTUI-010`<br>`@BSH-OPENTUI-017`<br>`@BSH-OPENTUI-018` | 1. Envio do prompt: `"What are the asset rules?"`<br>2. Enfileiramento durante a execução: `"List the asset status values"`<br>3. Alternância de raciocínio via `Ctrl+O`<br>4. Redimensionamento do terminal para 140, 80, 60 e 35 colunas | Entrada aceita rascunhos durante execução; prompt enfileirado recebe badge `[QUEUED]`; rodapé exibe `Queue:1`; `Ctrl+O` expande/recolhe card de raciocínio; componentes adaptam layout entre 35 e 140 colunas sem quebra ou sobreposição. | Prompt enfileirado exibiu badge `[QUEUED]`; telemetria registrou `Queue:1`; `Ctrl+O` alternou raciocínio; redimensionamento para 140, 80, 60 e 35 colunas adaptou o layout preservando entrada, telemetria e integridade visual. | **Passou** |
| **Cenários 3 e 4: Mudança Conforme vs Bloqueio de Conflito**<br>`@BSH-OPENTUI-008`<br>`@BSH-OPENTUI-013` | 1. Solicitação conforme: `"Add an English comment explaining the existing transfer validation without changing its rules"`<br>2. Solicitação conflitante: `"Remove the validation and transfer the retired asset without required fields"`<br>3. Tecla `Escape` no alerta de governança | Mudança conforme executada em workspace isolado e validada por SHACL. Mudança conflitante interceptada com alerta formal de governança; cancelamento via Escape aborta a requisição sem chamadas ao modelo e sem modificar arquivos. | Solicitação conforme inspecionada com diff e semântica aderente. Solicitação conflitante gerou alerta de governança; o cancelamento com Escape cancelou o turno imediatamente; os arquivos originais permaneceram inalterados. | **Passou** |
| **Cenário 5: Verificação do Adaptador Codex**<br>`@codex`<br>`@codex-smoke`<br>`@BSH-LEGACY-001` | Invocação direta: `bsh --project /tmp/bsh-pilot-jornada-16 codex` | Se o comando não existir ou recusar iniciar, registrar ambos os casos (conforme e contrário) como bloqueados antes do primeiro turno. | Processo finalizou com código 2 e mensagem: `Comando desconhecido. Use bsh --help.` Ambos os casos foram registrados formalmente como bloqueados antes do primeiro turno. Sessão nativa não substituiu esse resultado. | **Bloqueado antes do 1º turno (conforme regra)** |
| **Cenário 6: Preservação de Evidências**<br>`@BSH-EVAL-001`<br>`@BSH-OPENTUI-013` | Geração de vídeo MP4 com slide inicial preto/branco e captura final PNG; cópia para `/mnt/c/Users/clayt/Downloads/bsh/` e conferência de SHA-256. | Artefatos preservados localmente e sincronizados em Downloads com hash idêntico; sessões tmux encerradas. | Vídeo MP4 codificado com slide inicial; captura PNG salva; cópia para Downloads realizada; hashes SHA-256 verificados como idênticos; sessão tmux encerrada. | **Passou** |

---

## 3. Evidências Coletadas e Hashes SHA-256

Os artefatos oficiais foram gerados e sincronizados para o diretório de Downloads do WSL (`/mnt/c/Users/clayt/Downloads/bsh/`):

1. **Vídeo E2E da Jornada 16**:
   - Arquivo Local: `evaluation/videos/bsh-opentui-reconstruction-scenario.mp4`
   - Arquivo WSL Downloads: `/mnt/c/Users/clayt/Downloads/bsh/bsh-jornada-16-batch-20261003-opentui.mp4`
   - Tamanho: 636.883 bytes (20,4 segundos a 10 fps)
   - SHA-256: `fa45fb23e265fe5dc383e5535543533d69df826bd558e226bb657673b4e24e6d` (Hashes idênticos confirmados)

2. **Captura de Tela Final**:
   - Arquivo Local: `evaluation/screenshots/bsh-opentui-reconstruction-scenario.png`
   - Arquivo WSL Downloads: `/mnt/c/Users/clayt/Downloads/bsh/bsh-jornada-16-batch-20261003-opentui.png`
   - Tamanho: 44.205 bytes
   - SHA-256: `53fd10b53fe4e1cc120d542c3d2532ec6e4883725f4716374ae56e45877af416` (Hashes idênticos confirmados)

---

## 4. Gastos de Tokens e Economia em Relação ao Codex

Em estrita conformidade com a regra de integridade de avaliação (`@BSH-EVAL-001`):

- **Tokens gastos pelo harness BSH (verificação ontológica)**: Não aplicável diretamente nesta rodada, pois o adaptador Codex não pôde ser inicializado pelo comando `bsh codex` (`Comando desconhecido. Use bsh --help.`).
- **Economia em relação ao Codex direto**: **Indisponível**. Como o adaptador Codex não iniciou para executar os turnos em paralelo, não há denominador real medido para comparação estatística ou cálculo de economia percentual/absoluta.
- **Registro de Limitação**: Não foram utilizados contadores simulados como evidência; a ausência de medição real do adaptador está expressamente documentada como limitação da versão atual.

---

## 5. Limitações e Correções Propostas

1. **Adaptador Codex**: O binário CLI do BSH atualmente expõe comandos para `tui`, `init`, `domain`, `ontology`, `sessions`, `mcp`, `auth` e `skill`, sem um comando `bsh codex` direto implementado no pacote CLI. Correção proposta: implementar um subcomando `bsh codex` que encapsule a execução governada do Codex CLI com servidor MCP local, atendendo aos cenários de fumaça legados.
2. **Distribuição Global com Bun**: O pacote npm embute com sucesso o runtime Bun em `node_modules/bun/bin/bun.exe`, permitindo que usuários executem o OpenTUI via Node sem necessidade de instalar Bun previamente no PATH global.
