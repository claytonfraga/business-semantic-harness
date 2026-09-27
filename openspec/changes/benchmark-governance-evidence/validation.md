## Validação

- `python3 -m unittest benchmark.tests.test_governance_reporting benchmark.tests.test_scientific_pipeline -q`: 39 testes sintéticos aprovados; nenhum agente ou execução experimental iniciado.
- Testes dirigidos de `test_technical_execution_report.py` para estrutura factual e telemetria ausente: 2 aprovados, sem executar o caso de Agy.
- O teste de governança cria um batch sintético temporário, verifica o `.tex` renderizado, a conversão por `pdflatex` do sistema operacional, o gate de layout do PDF resultante e o bloqueio após adulteração da evidência.
- `git diff --check`: aprovado.

## Limitação

A suíte completa não foi executada porque inclui testes com Agy, excluídos por instrução do usuário. O benchmark experimental e seus agentes não foram executados.
