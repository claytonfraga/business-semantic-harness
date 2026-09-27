## Why

O BSH passou a produzir uma decisão canônica com status semântico, shapes, validações, fingerprint e decisão de promoção. A coleta do benchmark ainda consultava campos legados e selecionava o último arquivo encontrado. Isso podia omitir evidência real ou atribuir uma decisão à sessão errada.

## What Changes

- Vincular relatório de sessão e decisão pelo identificador da sessão da run.
- Preservar no registro canônico os campos e a proveniência da decisão, sem converter ausência em `false`.
- Exibir diagnóstico factual por run no relatório técnico.
- Exigir evidência completa do gate para as análises de enforcement independente.
- Registrar explicitamente o fluxo `.tex` → ferramenta LaTeX do sistema operacional → `.pdf` → validação de layout para ambos os relatórios.

## Capabilities

### New Capabilities

- `governance-evidence-reporting`: coleta e apresentação rastreável da decisão de governança.

### Modified Capabilities

- `multi-agent-benchmark`: amplia a evidência canônica consumida pelos relatórios sem mudar agente, modelo, condições, tarefas ou estimandos.

## Impact

- Código: coleta, normalização, elegibilidade, modelo do relatório técnico e orquestrador em `benchmark/`.
- Compatibilidade: runs antigas sem a nova decisão continuam legíveis, com evidência de enforcement ausente e sem reivindicação de ativação independente.
- A regra legada de ausência de Markdown no relatório científico não se aplica ao registro técnico posterior por batch, que mantém seu `.md` auxiliar. Os documentos publicáveis continuam a nascer de `.tex`.
