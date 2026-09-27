## Verificação local

- `python3 -m unittest benchmark.tests.test_execution_instrumentation benchmark.tests.test_governance_reporting benchmark.tests.test_scientific_pipeline -q`: 46 testes aprovados, incluindo a execução sintética com adapter substituído; nenhum agente ou batch real foi iniciado.
- `openspec validate benchmark-execution-instrumentation --strict --no-interactive`: aprovado.
- `git diff --check`: aprovado.

Os testes com Agy e o benchmark experimental não foram executados.
