# Relatório Experimental do Business Semantic Harness (BSH)

- **Lote:** `complete_a_d`
- **Agente:** `agy`
- **Modelo:** `gemini-3.7-flash`
- **Commit BSH:** `a1b2c3d4e5f6`
- **Status do Lote:** `VALID`

## 1. Qualidade dos Dados e Telemetria
- **Tarefas Planejadas:** 10
- **Tarefas Observadas:** 10
- **Execuções Observadas:** 20
- **Pares Completos de Tokens:** 10
- **Pares Completos de Duração:** 10

## 2. Resumo de Perguntas de Pesquisa (RQs)
- **RQ1 (Consumo de Tokens):** `RESPONDIDA`
- **RQ2 (Trade-off e Benefício Líquido):** `RESPONDIDA`
  - Economia Total em Violadoras: 37500.0
  - Overhead Total em Válidas: 2600.0
  - Benefício Líquido: 34900.0
- **RQ3 (Regras Textuais):** `NAO_AVALIADA` (Condição B (regras textuais no prompt) não foi executada neste lote.)
- **RQ4 (Ontologia Formal):** `NAO_AVALIADA` (Condição C (ontologia sem enforcement) não foi executada neste lote.)
- **RQ5 (Enforcement Independente):** `NAO_AVALIADA` (Condição C não foi executada; o contraste A × D avalia o efeito combinado do BSH, não isolando causalmente o enforcement independente.)
- **RQ6 (Reconhecimento Semântico):** `RESPONDIDA`

## 3. Artefatos de Auditoria
- Dados brutos: `measurements.csv` e `measurements.json`
- Pares e elegibilidade: `paired-results.csv`
- Qualidade dos dados: `data-quality.json`
- Estatísticas detalhadas: `statistics.json` e `statistics.md`
- Relatório TeX: `report.tex` (ou `report/benchmark-report.tex`)
- Relatório PDF compilado: `report.pdf`
