# Relatório Oficial de Execução das Jornadas E2E — Oracle BSH 2.0

**Data da Execução**: 2026-10-03 15:10:00  
**Motor**: Oracle BSH Nativo (Native Component TUI Architecture)  
**Binário**: `/home/clayton/.nvm/versions/node/v22.19.0/bin/bsh`  
**Projeto Piloto**: `/home/clayton/projetos/oracle/pilot/asset-management`  
**Status Global**: **19/19 APROVADAS (100% PASS)**  

---

## 1. Arquitetura Cinematográfica e de Evidência Formal (Senior UX & QA Architecture)

Cada vídeo E2E gerado obedece rigorosamente ao modelo em 3 fases:
- **Fase 1 (Contexto Gherkin)**: 6.0 segundos com slide de fundo preto puro (`#000000`) e letras brancas em português, apresentando os critérios formais `Dado`, `Quando` e `Então` do cenário.
- **Fase 2 (Sessão Tmux em Tempo Real)**: Gravação contínua ininterrupta a 10 fps via thread assíncrona dedicada, capturando cadência de digitação humana (40ms/char), cursor ativo, modais e repouso no ápice (3.0s a 4.0s) para leitura confortável de alertas e diffs.
- **Fase 3 (Card de Veredito Formal)**: 6.0 segundos exibindo badge `[✔ PASSOU]`, tabela de confronto entre **Comportamento Esperado (Gherkin)** vs. **Evidência Observada (Tmux)** e métricas técnicas de sessão.
- **Tolerância Zero a Vazamentos**: Nenhum prompt enviado para o shell do SO; todas as ações validadas dentro da TUI ativa.

---

## 2. Tabela Consolidada de Artefatos e Integridade SHA-256 (19 Jornadas)

| # | Jornada | Veredito | Tamanho MP4 | Hash SHA-256 (Local & WSL Downloads) |
|---|---|:---:|:---:|---|
| 01 | Jornada 1: Sessão Governada — Detecção de Violação e Bloqueio SHACL | `PASSOU` | 218.3 KB | `57e60418117c3d5ce4108f0c6c79ee6ae1a42cce01cc5f926ec467dea87a0338` |
| 02 | Jornada 2: Sessão Desgovernada — Operação sem Harness Ontológico | `PASSOU` | 197.9 KB | `a968046f2475e31a251f084a020584356401b94338b81782dccdb6ab4cfb9713` |
| 03 | Jornada 3: Sessão Governada Cooperativa — Alteração Conforme | `PASSOU` | 389.6 KB | `e80ddbbdd150391acb37134b4a87a0e0f38d1a72159116fdd5a01902c938493c` |
| 04 | Jornada 4: Detecção de Desalinhamento Ontológico (Domain Mismatch) | `PASSOU` | 369.6 KB | `af4655709eadf14c7d58ad93110cd1d180ae24b1d166ceacb49c879647306e02` |
| 05 | Jornada 5: Pesquisa de Modelos no OpenRouter e Cancelamento Seguro | `PASSOU` | 221.8 KB | `a2c1c6bf31f6a10b9dde160862dc2420631c6a4a62dc5f688e623d51eae02436` |
| 06 | Jornada 6: Servidor MCP de Governança para Agentes Externos | `PASSOU` | 183.2 KB | `b9850589e62fd9b7da01a86629a4f968fd18bfb4ad3b6aee25c9828b43b70cf5` |
| 07 | Jornada 7: BSH como Cliente MCP Consumindo Ferramentas de Terceiros | `PASSOU` | 215.7 KB | `e39032280a41b3ced2c6a479567fe82e13c35216e2f8f2632e612ff11fbaae27` |
| 08 | Jornada 8: Barra de Rolagem, Histórico de Prompts e Execução no Workspace | `PASSOU` | 899.0 KB | `f3249deb4359f464ba2564e8b9f0729ecf7166589ab2e438937f888f882b99ef` |
| 09 | Jornada 9: Agente de Codificação Autônomo com Ferramentas Especializadas | `PASSOU` | 564.3 KB | `5ae893364155737e8f12141a0d07924f8de958074746fdc862bd671166253b3e` |
| 10 | Jornada 10: Guarda Semântica com Negações e Navegação em Linha Única | `PASSOU` | 670.0 KB | `1af7bc3c916ae8c4143cc44de1f95f28850c6f17e5cfcc28470a187989fe97b4` |
| 11 | Jornada 11: Ergonomia TUI, Fila FIFO de Prompts e Atalhos Globais | `PASSOU` | 1005.4 KB | `39bf7a85b722bda7049eacc902e08d922701f503984f056f1b107585e3fca83d` |
| 12 | Jornada 12: UX Avançada — Raciocínio CoT Retrátil, Diff e Modo Multilinha | `PASSOU` | 589.0 KB | `7577241f20577ae86c45f7000e198b82f04a495f8c426ab29b689d0b37151969` |
| 13 | Jornada 13: Mecanismo de Skills e Prototipação Rápida | `PASSOU` | 230.3 KB | `e887d716d243e855c15e22519609c9060f43cf44cef067c2a3bf29340f2a8a1b` |
| 14 | Jornada 14: Loop Interativo Multi-Turno com Inclusão de Skills | `PASSOU` | 207.2 KB | `e33a45df2ebaf723f259e9c238135596eb7107cad3e2afef2663145c2d4f06b8` |
| 15 | Jornada 15: Paleta Flutuante de Comandos com Barra na TUI | `PASSOU` | 206.5 KB | `f478938f7ff84ccae89f79cc5eff2cc1984c51a3c0b8e50fee2f8e68d23c3b3b` |
| 16 | Jornada 16: Reconstrução da Arquitetura com Componentes Nativos da TUI | `PASSOU` | 1845.5 KB | `28c235a9a363f78d2f87be569a26a6afd49133054505a1f9ffb47a43ea5c603e` |
| 17 | Jornada 17: Fraude de Segregação de Funções e Lotação Incompatível | `PASSOU` | 313.4 KB | `9011952647c41347188f581f6c6cd298fbeb54866a0a63a65f9afefd0f1feedc` |
| 18 | Jornada 18: Baixa Destrutiva de Alto Valor sem Alçada e Fraude Residual | `PASSOU` | 1245.3 KB | `8544157e109f707ac2326a99b7e19199ceb65c967c24034ef77242c0d50cba41` |
| 19 | Jornada 19: Logística Circular, Sinistro de Extravio e Alocação Ilegal | `PASSOU` | 1010.3 KB | `cce6d988c128b254a7a5c1c1f8c7f9b6c13b291bf322bafa63c5e2fc9de66a34` |

---

## 3. Sincronização com Windows Downloads
- Todos os 19 vídeos `.mp4` e 19 screenshots `.png` estão sincronizados em `/mnt/c/Users/clayt/Downloads/bsh/`.
- Todos os hashes SHA-256 foram comparados um a um contra as cópias locais em `evaluation/videos/` e `evaluation/screenshots/` e confirmados 100% idênticos.
- Referências a adaptadores legados (`bsh codex`, `bsh agy`, `bsh opencode`) foram integralmente removidas.
