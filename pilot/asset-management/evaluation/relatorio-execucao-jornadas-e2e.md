# Relatório Oficial de Execução das Jornadas E2E — Oracle BSH 2.0

**Data da Execução**: 2026-10-03 15:00:44
**Motor**: Oracle BSH Nativo (OpenTUI Component Architecture)
**Binário**: `/home/clayton/.nvm/versions/node/v22.19.0/bin/bsh`
**Projeto Piloto**: `/home/clayton/projetos/oracle/pilot/asset-management`
**Status Global**: **16/16 APROVADAS (100% PASS)**

## Arquitetura Cinematográfica e de Evidência
- **Fase 1 (Contexto Gherkin)**: 6.0 segundos com slide de fundo preto puro (#000000) e letras brancas em português.
- **Fase 2 (Sessão Tmux em Tempo Real)**: Gravação contínua ininterrupta a 10 fps via thread assíncrona, cadência de digitação humana (40ms/char), verificação estrita contra vazamento de shell e repouso em ápice.
- **Fase 3 (Card de Veredito Formal)**: 6.0 segundos exibindo badge APROVADO, tabela de Esperado vs Observado e métricas técnicas.
- **Tolerância Zero a Vazamentos**: Nenhum prompt enviado para o shell do SO; todas as ações validadas dentro da TUI ativa.

## Tabela de Artefatos e Integridade SHA-256
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
| 15 | Jornada 15: Paleta Flutuante de Comandos com Barra no OpenTUI | `PASSOU` | 206.5 KB | `f478938f7ff84ccae89f79cc5eff2cc1984c51a3c0b8e50fee2f8e68d23c3b3b` |
| 16 | Jornada 16: Reconstrução da Arquitetura com Componentes OpenTUI | `PASSOU` | 1845.5 KB | `28c235a9a363f78d2f87be569a26a6afd49133054505a1f9ffb47a43ea5c603e` |

## Sincronização
- Todos os 16 vídeos e 16 capturas de tela foram copiados para `/mnt/c/Users/clayt/Downloads/bsh` e validados com hashes estritamente idênticos.
- Referências legadas a terceiros (`bsh codex`, `bsh agy`, `bsh opencode`) foram removidas de acordo com as especificações atuais do agente nativo.
