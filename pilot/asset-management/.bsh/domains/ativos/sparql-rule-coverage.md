# Relatório de Cobertura de Regras SHACL-SPARQL

| Constraint SHACL-SPARQL | Regra de Negócio | Operação | Casos (+) | Casos (-) | Fronteira | Multirregra | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `ex:TransferenciaCompatibilidadeOrganizacionalShape` | Verifica se o novo responsável está ativamente lotado no departamento de destino da transferência. | `TransferenciaAtivo` | 57 | 17 | 5 | 10 | **TOTAL** |
| `ex:BaixaValorResidualShape` | Exige laudo técnico de descarte quando o ativo a ser baixado possuir valor residual contábil positivo. | `BaixaAtivo` | 70 | 30 | 10 | 10 | **TOTAL** |
| `ex:ReservaConflitoDatasShape` | Valida que a data de término da reserva seja estritamente posterior ou igual à data de início. | `ReservaAtivo` | 10 | 10 | 5 | 5 | **TOTAL** |
| `ex:BaixaAltoValorAprovacaoShape` | Exige autorização formal de aprovador de alçada superior para baixa de bens com valor de aquisição > R$ 10.000. | `BaixaAtivo` | 10 | 10 | 5 | 10 | **TOTAL** |
| `ex:AlocacaoCompatibilidadeDepartamentoShape` | Garante que o colaborador que recebe o ativo pertença a um departamento válido cadastrado. | `AlocacaoUsuario` | 10 | 10 | 5 | 5 | **TOTAL** |
