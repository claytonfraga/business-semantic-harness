# Sumário Estatístico Experimental do BSH

- **Lote:** negative_net_benefit
- **RQ1 Status:** `RESPONDIDA`
- **RQ2 Status:** `RESPONDIDA`
- **RQ3 Status:** `NAO_AVALIADA`
- **RQ4 Status:** `NAO_AVALIADA`
- **RQ5 Status:** `NAO_AVALIADA`
- **RQ6 Status:** `RESPONDIDA`

## 1. Estatísticas de Consumo Pareado de Tokens

| Segmento | n Observado | n Elegível | Média Direto | Média BSH | Diferença Média (Tokens) | Variação Média (%) | Fator de Custo Médio | IC 95% Inferior | IC 95% Superior |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Todas** | 10 | 10 | 10,000 | 14,900 | 4,900 | 49.0% | 1.49 | -2,679 | 12,479 |
| **Válidas** | 3 | 3 | 10,000 | 26,667 | 16,667 | 166.7% | 2.67 | -19,189 | 52,522 |
| **Violadoras** | 5 | 5 | 10,000 | 9,800 | -200 | -2.0% | 0.98 | -200 | -200 |

## 2. Balanço de Trade-off (RQ2)

- **Pares Violadores com BLOQUEIO_CORRETO:** 5
- **Pares Válidos com ALTERACAO_CORRETA:** 3
- **Economia Total em Tarefas Violadoras:** 1,000 tokens
- **Overhead Total em Tarefas Válidas:** 50,000 tokens
- **Benefício Líquido Global:** -49,000 tokens (-61.3%)
- **Motivo de Incompletude (se aplicável):** Nenhum (cálculo completo)

## 3. Avaliação de RQs

- **RQ1:** `RESPONDIDA`
- **RQ2:** `RESPONDIDA`
- **RQ3:** `NAO_AVALIADA` (Condição B (regras textuais no prompt) não foi executada neste lote.)
- **RQ4:** `NAO_AVALIADA` (Condição C (ontologia sem enforcement) não foi executada neste lote.)
- **RQ5:** `NAO_AVALIADA` (Condição C não foi executada; o contraste A × D avalia o efeito combinado do BSH, não isolando causalmente o enforcement independente.)
- **RQ6:** `RESPONDIDA` (Recall: 1.00, Precision: 1.00)
