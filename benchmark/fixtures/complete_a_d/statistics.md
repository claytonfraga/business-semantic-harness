# Sumário Estatístico Experimental do BSH

- **Lote:** complete_a_d
- **RQ1 Status:** `RESPONDIDA`
- **RQ2 Status:** `RESPONDIDA`
- **RQ3 Status:** `NAO_AVALIADA`
- **RQ4 Status:** `NAO_AVALIADA`
- **RQ5 Status:** `NAO_AVALIADA`
- **RQ6 Status:** `RESPONDIDA`

## 1. Estatísticas de Consumo Pareado de Tokens

| Segmento | n Observado | n Elegível | Média Direto | Média BSH | Diferença Média (Tokens) | Variação Média (%) | Fator de Custo Médio | IC 95% Inferior | IC 95% Superior |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Todas** | 10 | 10 | 9,500 | 6,030 | -3,470 | -36.5% | 0.63 | -6,526 | -414 |
| **Válidas** | 3 | 3 | 9,500 | 10,433 | 933 | 9.8% | 1.10 | -644 | 2,511 |
| **Violadoras** | 5 | 5 | 9,500 | 2,000 | -7,500 | -78.9% | 0.21 | -7,500 | -7,500 |

## 2. Balanço de Trade-off (RQ2)

- **Pares Violadores com BLOQUEIO_CORRETO:** 5
- **Pares Válidos com ALTERACAO_CORRETA:** 2
- **Economia Total em Tarefas Violadoras:** 37,500 tokens
- **Overhead Total em Tarefas Válidas:** 2,600 tokens
- **Benefício Líquido Global:** 34,900 tokens (52.5%)
- **Motivo de Incompletude (se aplicável):** Nenhum (cálculo completo)

## 3. Avaliação de RQs

- **RQ1:** `RESPONDIDA`
- **RQ2:** `RESPONDIDA`
- **RQ3:** `NAO_AVALIADA` (Condição B (regras textuais no prompt) não foi executada neste lote.)
- **RQ4:** `NAO_AVALIADA` (Condição C (ontologia sem enforcement) não foi executada neste lote.)
- **RQ5:** `NAO_AVALIADA` (Condição C não foi executada; o contraste A × D avalia o efeito combinado do BSH, não isolando causalmente o enforcement independente.)
- **RQ6:** `RESPONDIDA` (Recall: 1.00, Precision: 1.00)
