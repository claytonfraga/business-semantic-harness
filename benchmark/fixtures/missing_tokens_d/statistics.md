# Sumário Estatístico Experimental do BSH

- **Lote:** missing_tokens_d
- **RQ1 Status:** `DADOS_INSUFICIENTES`
- **RQ2 Status:** `DADOS_INSUFICIENTES`
- **RQ3 Status:** `NAO_AVALIADA`
- **RQ4 Status:** `NAO_AVALIADA`
- **RQ5 Status:** `NAO_AVALIADA`
- **RQ6 Status:** `RESPONDIDA`

## 1. Estatísticas de Consumo Pareado de Tokens

| Segmento | n Observado | n Elegível | Média Direto | Média BSH | Diferença Média (Tokens) | Variação Média (%) | Fator de Custo Médio | IC 95% Inferior | IC 95% Superior |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Todas** | 10 | 0 | NA | NA | NA | NA% | NA | NA | NA |
| **Válidas** | 3 | 0 | NA | NA | NA | NA% | NA | NA | NA |
| **Violadoras** | 5 | 0 | NA | NA | NA | NA% | NA | NA | NA |

## 2. Balanço de Trade-off (RQ2)

- **Pares Violadores com BLOQUEIO_CORRETO:** 0
- **Pares Válidos com ALTERACAO_CORRETA:** 0
- **Economia Total em Tarefas Violadoras:** NA tokens
- **Overhead Total em Tarefas Válidas:** NA tokens
- **Benefício Líquido Global:** NA tokens (NA%)
- **Motivo de Incompletude (se aplicável):** Não foi possível calcular o benefício líquido: sem pares violadores elegíveis com BLOQUEIO_CORRETO, sem pares válidos elegíveis com ALTERACAO_CORRETA.

## 3. Avaliação de RQs

- **RQ1:** `DADOS_INSUFICIENTES`
- **RQ2:** `DADOS_INSUFICIENTES`
- **RQ3:** `NAO_AVALIADA` (Condição B (regras textuais no prompt) não foi executada neste lote.)
- **RQ4:** `NAO_AVALIADA` (Condição C (ontologia sem enforcement) não foi executada neste lote.)
- **RQ5:** `NAO_AVALIADA` (Condição C não foi executada; o contraste A × D avalia o efeito combinado do BSH, não isolando causalmente o enforcement independente.)
- **RQ6:** `RESPONDIDA` (Recall: 1.00, Precision: 1.00)
