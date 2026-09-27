## 1. Coleta e contrato canônico

- [x] 1.1 Associar relatório e decisão pela sessão, preservar SHA-256 e ausência como `null`.
- [x] 1.2 Transportar a decisão para o registro bruto e normalizado da run.

## 2. Relatórios e elegibilidade

- [x] 2.1 Expor diagnóstico e proveniência por run no relatório técnico.
- [x] 2.2 Exigir evidência explícita de validação e bloqueio para RQ5/RQ11.
- [x] 2.3 Registrar no OpenSpec o fluxo `.tex` → ferramenta do sistema operacional → `.pdf` → validação para os dois relatórios.

## 3. Verificação sintética

- [x] 3.1 Testar sessão exata, ambiguidade, ausência, shapes, erros e rótulos legados sem executar agentes.
- [x] 3.2 Testar modelo técnico, conversão LaTeX pelo sistema e gate de layout em fixture temporária.
- [x] 3.3 Conferir regressões de análise e integridade final do diff.
