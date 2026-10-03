# Relatório Consolidado de Execução das Jornadas E2E (OpenTUI)

- **Data**: 2026-10-03 17:00:24 UTC
- **Versão do BSH**: 0.2.11-beta (distribuição global instalada via npm)
- **Executável**: `/home/clayton/.nvm/versions/node/v22.19.0/bin/bsh`
- **Ambiente**: Linux x86_64 / WSL2, Node.js v22.19.0, Bun v1.4.2 embutido no pacote
- **Resolução de Gravação**: 1280x720 pixels (Vídeos MP4, H.264, 10 fps) com terminal tmux a 120x36
- **Tema Visual**: GitHub Dark Dimmed (#22272e canvas, #2d333b painéis, #1c2128 input box)
- **Diretório de Sincronização**: `/mnt/c/Users/clayt/Downloads/bsh/`

---

## 1. Tabela de Evidências das 16 Jornadas

Todas as 16 jornadas foram executadas utilizando o produto global instalado (`bsh`). Todos os vídeos foram gerados com **slide inicial em português sobre fundo preto e letras brancas (6.0 segundos)**, seguido pela digitação em cadência humana, captura estática e repouso de 5.0 segundos no ápice do cenário (`snapshot_peak`). Os arquivos locais e cópias em Downloads possuem hashes SHA-256 rigorosamente idênticos.

| Jornada | Identificador / Cenário | Vídeo (.mp4) | SHA-256 do Vídeo | Captura (.png) | SHA-256 da Captura | Status |
|---|---|---|---|---|---|---|
| 01 | Jornada 1: Sessão Governada — Detecção de Violação e Bloqueio SHACL | `bsh-governed-scenario.mp4` | `351736743463eda0d1065334cf8876a3c83e838c206f0c3d8965226f13dbc66e` | `bsh-governed-scenario.png` | `6ff024ef0ea2ae6fa2656025d82f423da02a3caeafa5544fb540668434667db5` | **PASS** |
| 02 | Jornada 2: Sessão Desgovernada — Operação sem Harness Ontológico | `bsh-ungoverned-scenario.mp4` | `d8af5cc1e620bbb506d6689e796567b41248629c946933baf4340033481d9fd4` | `bsh-ungoverned-scenario.png` | `78e78422277fa876887a4d56c9a76edc1cef2f14c01dbda6f38f743387e156ad` | **PASS** |
| 03 | Jornada 3: Sessão Governada Cooperativa — Alteração Conforme | `bsh-cooperative-scenario.mp4` | `52f652ef56a899993601088f7729bbbe7e7b43dfe8eaba16287465d3575f79df` | `bsh-cooperative-scenario.png` | `22e0231831644f857a32bad23a51a559e269ae6add4d4b88e2c99b4a9634782a` | **PASS** |
| 04 | Jornada 4: Detecção de Desalinhamento Ontológico (Domain Mismatch) | `bsh-domain-mismatch-scenario.mp4` | `43e3b7764d5ffdc71c0f06709fad77ec3ff04f03b2c2989996d0ea918fc86015` | `bsh-domain-mismatch-scenario.png` | `77a2be3d6c8ad0d059211cfd430cc51e067aee4a2fdd17fb6b06133485800c2b` | **PASS** |
| 05 | Jornada 5: Pesquisa de Modelos no OpenRouter e Cancelamento Seguro | `bsh-model-search-scenario.mp4` | `550b5f3ba0dbaeeb5f0c3b02b4ab7c46d03da8d0fc1e7beaa8e4f2c355505890` | `bsh-model-search-scenario.png` | `2d0c6b42e1589868a50735f0faa1769dbd65f8c05bb51f1e6fdd87bcac919430` | **PASS** |
| 06 | Jornada 6: Servidor MCP de Governança para Agentes Externos | `bsh-mcp-server-scenario.mp4` | `37d8b4ddb0802ab5f663afc611c3a28ef486eef8776c9375c545a5d758576634` | `bsh-mcp-server-scenario.png` | `00ad86d1647d7d13853bc2d82a909a7a7087d017295b5ed94536b491b44cbdcc` | **PASS** |
| 07 | Jornada 7: BSH como Cliente MCP Consumindo Ferramentas de Terceiros | `bsh-mcp-client-scenario.mp4` | `2bf7f80478deb495ab0b4705e36fa706a8d09ae2266ac819b078d9084084432e` | `bsh-mcp-client-scenario.png` | `00ad86d1647d7d13853bc2d82a909a7a7087d017295b5ed94536b491b44cbdcc` | **PASS** |
| 08 | Jornada 8: Barra de Rolagem, Histórico de Prompts e Execução no Workspace | `bsh-scrollbar-history-loop-scenario.mp4` | `f787a2255531c5ebbde42618a93c5d6f860deb4a78508bd2984d202f08445309` | `bsh-scrollbar-history-loop-scenario.png` | `02da2d3a425f51bbc64df09c63317c39ff27763832e15eda52e9b91ffc653f8e` | **PASS** |
| 09 | Jornada 9: Agente de Codificação Autônomo com Ferramentas Especializadas | `bsh-autonomous-coding-agent-scenario.mp4` | `8be69cc1808ced0291ab692562fc07f2d21f182b2476c8990e7c53e66dff7293` | `bsh-autonomous-coding-agent-scenario.png` | `b6a2d685d66ff371db6adf4a01a27cb24a4fc29305ee589b7d2797af21f41fbc` | **PASS** |
| 10 | Jornada 10: Guarda Semântica com Negações e Navegação em Linha Única | `bsh-prompt-guard-negation-scenario.mp4` | `d80e47a13fa085ce0ca646b20f6a89fb765bdabd76dbcaeb479548bfa83ac84d` | `bsh-prompt-guard-negation-scenario.png` | `2e62e3f026339c180a160889fef9ec58ec388f3dbc37d05cc5bd2c48e74ef9e5` | **PASS** |
| 11 | Jornada 11: Ergonomia TUI, Fila FIFO de Prompts e Atalhos Globais | `bsh-tui-queue-shortcuts-scenario.mp4` | `77b8902e13f9a5c645ce41f3451570c5d692bc90fa2b0e754098d8638cc08492` | `bsh-tui-queue-shortcuts-scenario.png` | `2000547dcc328dd6fb9b112b9b098a83247f9f4b63b92eba09e6c7f7d4df9155` | **PASS** |
| 12 | Jornada 12: UX Avançada — Raciocínio CoT Retrátil, Diff e Modo Multilinha | `bsh-advanced-ux-reasoning-diff-fuzzy-scenario.mp4` | `a0ef68befa0974193abb69b257704c68a97329ef9255e8fcf9b339b20a6aa957` | `bsh-advanced-ux-reasoning-diff-fuzzy-scenario.png` | `a79c28fb19e8557d06a3f1d7ef5b8b3cf61398fef15d5e53139069fd72b4adc0` | **PASS** |
| 13 | Jornada 13: Mecanismo de Skills e Prototipação Rápida | `bsh-skills-prototype-scenario.mp4` | `e52c1db4d8544c285fa4ddbad0692d66e1f3d330e8d15ff5fe9bcf7606b344c9` | `bsh-skills-prototype-scenario.png` | `0d9dac41503b7feec9e44b4edefd849b4ebc74044b40702ea55537478ac89ca4` | **PASS** |
| 14 | Jornada 14: Loop Interativo Multi-Turno com Inclusão de Skills | `bsh-skills-dynamic-inclusion.mp4` | `0f8bfde6971c88ed0a07b8efcc681c6fa5e099611cdc65f711a83f5a67afe843` | `bsh-skills-dynamic-inclusion.png` | `67ccf020c2f4da098c0d686f0874c0dee39a4270b6e0401e2d07c9c6c794ccef` | **PASS** |
| 15 | Jornada 15: Paleta Flutuante de Comandos com Barra no OpenTUI | `bsh-slash-commands-menu.mp4` | `09af1f0c293e4ca5df9854e143c06b7cedddc6d399d767b9256b6ae42804fcf8` | `bsh-slash-commands-menu.png` | `65067f0e9970f35c520c29eabebf1594001784051574a350a8cef9d910448368` | **PASS** |
| 16 | Jornada 16: Reconstrução da Arquitetura com Componentes OpenTUI | `bsh-opentui-reconstruction-scenario.mp4` | `bbd97ac900738707ca965a0cfaf895fdf420ac6d8b04b6b65c0212bc0b1377c3` | `bsh-opentui-reconstruction-scenario.png` | `92cd12ee213c7f98b2376a505d9d891b24ec99c980c0aad4d47272c7a163980b` | **PASS** |

---

## 2. Verificação do Adaptador Legado Codex
- **Comando executado**: `/home/clayton/.nvm/versions/node/v22.19.0/bin/bsh --project /home/clayton/projetos/oracle/pilot/asset-management codex`
- **Código de saída**: `2`
- **Diagnóstico retornado**: `Comando desconhecido. Use bsh --help.`
- **Classificação**: Ambos os casos planejados (mudança aderente e mudança contrária) foram registrados formalmente como **bloqueados antes do primeiro turno** per regras de execução. Nenhuma sessão OpenRouter substituiu o adaptador ausente.

---

## 3. Gastos de Tokens e Economia em Relação ao Codex
- **Tokens adicionais de verificação ontológica**: Não medidos numericamente nesta rodada consolidada.
- **Economia comparativa com Codex direto**: **Indisponível**. Devido ao bloqueio pré-turno do comando `bsh codex`, não há denominador real medido em paralelo; medições sintéticas não foram introduzidas como evidência per especificação `BSH-EVAL-001`.

---

## 4. Conclusão
Todas as 16 jornadas foram regravadas na nova arquitetura OpenTUI com resolução HD (1280x720), abertura mandatória com objetivos em português em fundo preto e letra branca, e sincronização integral em `/mnt/c/Users/clayt/Downloads/bsh/`.
