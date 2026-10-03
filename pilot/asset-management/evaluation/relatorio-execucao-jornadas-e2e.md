# Relatório Oficial de Execução das Jornadas E2E — Oracle BSH 2.0

**Data da Execução**: 2026-10-03 17:25:00
**Motor**: Oracle BSH Nativo (Native Component TUI Architecture)
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
| 01 | Jornada 1: Sessão Governada — Detecção de Violação e Bloqueio SHACL | `PASSOU` | 245.4 KB | `21bd96c45d5703910bbdc29591c52e24f062271277efce2237802752e14afbb0` |
| 02 | Jornada 2: Sessão Desgovernada — Operação sem Harness Ontológico | `PASSOU` | 274.0 KB | `e793dfe814fd1495f968c24d380094f18e336e5d0f3c1dafced5eb36dc6411d0` |
| 03 | Jornada 3: Sessão Governada Cooperativa — Alteração Conforme | `PASSOU` | 408.8 KB | `8ad56536889f967846d81b1c926112f449693e20bff9ce59d68fe06ca0b12a18` |
| 04 | Jornada 4: Detecção de Desalinhamento Ontológico (Domain Mismatch) | `PASSOU` | 140.3 KB | `b13b234f46939cb122bd53fedc196658f14ebcc8d96674e98415314947d0748f` |
| 05 | Jornada 5: Pesquisa de Modelos no OpenRouter e Cancelamento Seguro | `PASSOU` | 230.6 KB | `9d54b5e0bd19397681d5507ccf58353949ec5b394b9b9307cc0be944c8ca18d2` |
| 06 | Jornada 6: Servidor MCP de Governança para Agentes Externos | `PASSOU` | 191.6 KB | `9f75e4937addc6ef417e326d27d5b65fc35e48c3ae7456de96144c144be2353f` |
| 07 | Jornada 7: BSH como Cliente MCP Consumindo Ferramentas de Terceiros | `PASSOU` | 218.7 KB | `6099469be573a5ccc7303fae4e6d26f6216b459aed63e79eb839301c25680e6e` |
| 08 | Jornada 8: Barra de Rolagem, Histórico de Prompts e Execução no Workspace | `PASSOU` | 475.6 KB | `988dd9d316b3a4ab82653f9e7929dbf1cb5c5e0556079985fe9022e05c9ed94b` |
| 09 | Jornada 9: Agente de Codificação Autônomo com Ferramentas Especializadas | `PASSOU` | 270.9 KB | `80c970e5bf3599cfb7be91081b29899be6db58bf7a33eedb95e91f489dae97a5` |
| 10 | Jornada 10: Guarda Semântica com Negações e Navegação em Linha Única | `PASSOU` | 521.9 KB | `bef009f2e044fe62dc0b38d9e157fbbe5a3818c98dcaec3347739dfe03f2046e` |
| 11 | Jornada 11: Ergonomia TUI, Fila FIFO de Prompts e Atalhos Globais | `PASSOU` | 383.0 KB | `09d95b595e480d92200d5196d753c608ff214c9d2cad964b738ec2606d34491f` |
| 12 | Jornada 12: UX Avançada — Raciocínio CoT Retrátil, Diff e Modo Multilinha | `PASSOU` | 345.3 KB | `5a6d10f5b92fecd5ec79095408f42fe0ac38861d83fb62bd58575ef61f4189e2` |
| 13 | Jornada 13: Mecanismo de Skills e Prototipação Rápida | `PASSOU` | 240.2 KB | `a1bffb42384e26ae858490b6ef09bd66119239c8f912c66220bfab6bf256d601` |
| 14 | Jornada 14: Loop Interativo Multi-Turno com Inclusão de Skills | `PASSOU` | 204.5 KB | `63df0816cc23ea698041bc635e2abb9b364ac4715673683d7e4967a9bf5ad3d7` |
| 15 | Jornada 15: Paleta Flutuante de Comandos com Barra na TUI | `PASSOU` | 201.9 KB | `aa0e4bd7a70fcf27009182d5450abdafe4cbff2061e1375c7e261a925bdea7fb` |
| 16 | Jornada 16: Reconstrução da Arquitetura com Componentes Nativos da TUI | `PASSOU` | 1416.2 KB | `1c4e68bd0d8155142221a5d354796dfb69a46c2571b830747bc31550a0534681` |
| 17 | Jornada 17: Fraude de Segregação de Funções e Lotação Incompatível | `PASSOU` | 587.9 KB | `22f50784429815c24c47ee59cba5b6219e23b39d75b117f10bec86396a8164cc` |
| 18 | Jornada 18: Baixa Destrutiva de Alto Valor sem Alçada e Fraude Residual | `PASSOU` | 1974.8 KB | `8e24ec95eccaf8c7064740c5077646fe60e26b413000a7636ee6295e492e4f75` |
| 19 | Jornada 19: Logística Circular, Sinistro de Extravio e Alocação Ilegal | `PASSOU` | 967.0 KB | `bd207a249a2797e05993b436e90e28eef1dd2deb9dd0ad7ba0a83b0f37b9920d` |

## Sincronização
- Todos os 16 vídeos e 16 capturas de tela foram copiados para `/mnt/c/Users/clayt/Downloads/bsh` e validados com hashes estritamente idênticos.
- Referências legadas a terceiros (`bsh codex`, `bsh agy`, `bsh opencode`) foram removidas de acordo com as especificações atuais do agente nativo.
