## Why

O orquestrador não preenche alguns campos que o gate técnico exige. Isso impede verificar horários, testes, diff e integridade do origin após uma execução real.

## What Changes

- Registrar horários e status observados de cada run.
- Registrar execução e resultado dos testes, além de arquivos criados/removidos e hash do diff.
- Registrar os commits do origin antes e depois da execução e detectar alterações inesperadas.
- Preservar ausência de medição como `null` e ajustar a exigência de resultado de testes quando nenhum teste foi executado.

## Impact

Afeta somente a instrumentação do benchmark e o gate técnico do Relatório Técnico da Execução Experimental. Não altera tarefas, oracles, condições, políticas ou análise científica.
