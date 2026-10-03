# Regras de Negócio Candidatas (Candidate Business Rules)

Este documento registra oportunidades de evolução e regras de negócio identificadas durante a modelagem da base semântica do domínio patrimonial, preservando o princípio de não modificar unilateralmente as regras de negócio em vigor sem justificativa e alinhamento prévio (Seção 37).

---

## 1. Regra Candidata: Quarentena Pós-Manutenção para Ativos Críticos
- **Descrição:** Ativos de TI de infraestrutura crítica (ex: Servidores Rack e Storages) e Ativos de Instrumentação com calibração RBC devem cumprir período mínimo de quarentena de 24 horas antes de serem novamente alocados para produção após manutenção corretiva.
- **Motivação:** Evita retorno prematuro de equipamentos sem validação de burn-in ou estabilidade térmica/elétrica.
- **Fonte Atual:** Ausente nas regras em vigor; sugerida por boas práticas de gestão de ativos ISO 55000.
- **Impacto Potencial:** Introdução de estado intermediário `ex:EmQuarentena` ou constraint SHACL com checagem de intervalo entre `dataHoraConclusao` e `dataHoraAlocacao`.

---

## 2. Regra Candidata: Limite Cumulativo de Custódia Individual por Categoria
- **Descrição:** Um único colaborador não deve ter sob sua custódia simultânea mais de 3 notebooks corporativos ou mais de 2 veículos, exceto em casos de alocação especial com justificativa gerencial.
- **Motivação:** Previne acúmulo desnecessário de bens e mitiga risco de extravio não detectado.
- **Fonte Atual:** Ausente no código da aplicação; sugerida em políticas corporativas de governança patrimonial.
- **Impacto Potencial:** Exigiria contagem agregada SPARQL (`COUNT(?ativo) > 3`) vinculada a `ex:AlocacaoUsuario`.

---

## 3. Regra Candidata: Obrigatoriedade de Boletim de Ocorrência Policial para Extravio de Veículos
- **Descrição:** Para a classe `ex:AtivoVeiculo`, o registro de extravio deve exigir obrigatoriamente `ex:boletimOcorrencia` além de `ex:protocoloSinistro`.
- **Motivação:** Conformidade com exigências legais dos órgãos de trânsito (DETRAN/DENATRAN) e seguradoras automotivas.
- **Fonte Atual:** A propriedade `ex:boletimOcorrencia` existe no vocabulário, mas atualmente é opcional em `ex:RegistroExtravioShape`.
- **Impacto Potencial:** Especialização de `ex:RegistroExtravioShape` via `sh:or` ou shape derivado `ex:RegistroExtravioVeiculoShape`.
