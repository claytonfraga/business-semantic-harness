# language: pt
# Fontes: tarefas 30, 31 e 32; openspec/specs/evaluation-and-evidence.feature; openspec/specs/ontology-validation-and-query.feature
@bsh @eval @tasks30_32
Funcionalidade: Experimentos controlados, custo operacional e reprodução de decisões
  Como um arquiteto de qualidade
  Eu quero separar geração, consulta, representação e enforcement
  Para medir benefícios e limites sem transformar ausência de prova em adequação

  @BSH-EXP-001
  Cenário: Avaliar candidatos fixos sem geração
    Dado um candidato imutável e seu oráculo independente
    Quando o experimento fixo avalia reconhecimento, extração e decisão
    Então não deve chamar o gerador de agentes
    E cada etapa e seus fatos devem permanecer identificáveis
    E uma autorização simulada ou decisão de validação não deve ser registrada como promoção efetiva

  @BSH-EXP-002
  Cenário: Comparar geração com controles equivalentes
    Dado condições com regras textuais, consulta estruturada, consulta com enforcement e política alternativa
    Quando o mesmo experimento gera candidatos
    Então agente, versão, modelo, tarefa, prompt principal, orçamento, base e gates técnicos devem ser equivalentes
    E diferenças não previstas nos controles devem impedir análise pareada
    E contexto selecionado para geração deve permanecer separado da evidência independente de autorização
    E o candidato gerado deve percorrer reconhecimento, extração, validação e gates técnicos de produção

  @BSH-EXP-003
  Cenário: Separar consulta e enforcement sobre fatos equivalentes
    Dado um candidato e um grafo de fatos identificados por conteúdo
    Quando políticas alternativas são comparadas
    Então a identidade dos fatos deve ser a mesma entre as condições
    E políticas e correspondências utilizadas devem possuir registros recuperáveis
    E consulta sem enforcement deve registrar sua decisão observacional sem impor o gate semântico
    E condições com enforcement devem distinguir negativa de autorização e promoção realmente executada

  @BSH-EXP-004
  Cenário: Medir a contribuição de consulta geral SPARQL
    Dado a consulta estruturada existente e uma consulta geral SPARQL sobre a mesma fonte local
    Quando são comparadas
    Então consultas, resultados, fatos, duração e fonte devem ser recuperáveis e identificados
    E consulta geral não deve substituir restrição SHACL-SPARQL nem representar autorização
    E resultado vazio, ASK falso, erro, limite de resultados e timeout devem ser distintos
    E indisponibilidade do mecanismo deve ser explícita sem inventar contribuição adicional

  @BSH-EXP-005
  Cenário: Respeitar o escopo de comparações entre produtos
    Dado registros de diferentes produtos de governança
    Quando sua eficácia é comparada
    Então objeto governado e pontos de execução devem estar descritos
    E objetos ou pontos não equivalentes devem impedir conclusão direta de superioridade
    E redução isolada de tokens ou promoções não deve indicar adequação

  @BSH-EXP-006
  Cenário: Classificar eficácia segundo candidato, oráculo e decisão
    Dado observações de candidatos válidos, inválidos ou desconhecidos
    Quando as métricas são agregadas
    Então falso bloqueio deve exigir candidato existente, oráculo válido e promoção negada
    E violação promovida deve exigir promoção realmente executada e oráculo inválido
    E ausência de candidato, recusa, falha técnica, ausência de evidência, erro e timeout devem permanecer categorias distintas
    E indeterminação e cobertura de regras e evidências devem ser informadas com denominadores explícitos
    E ensaios de validação sem decisão de promoção não devem inventar falsos bloqueios ou violações promovidas

  @BSH-EXP-007
  Cenário: Avaliar explicação e trabalho humano por evidência verificável
    Dado explicações com referências aos registros estruturados
    Quando a qualidade da explicação é avaliada
    Então cada afirmação deve corresponder ao campo e valor recuperáveis do registro referenciado
    E referências ausentes ou divergentes devem ser identificadas
    E ausência de explicação ou medição humana deve ser indisponível e não nota perfeita ou tempo zero
    E tempo de revisão, trabalho humano e sua descrição devem permanecer registrados

  @BSH-EXP-008
  Cenário: Medir custos de implantação e execução recorrente
    Dado medições de consultas, extração, validação, geração, gates, preparação e manutenção de pacotes
    Quando os custos são agregados
    Então custo de implantação deve permanecer separado de custo recorrente
    E moedas diferentes não devem ser somadas sem conversão registrada
    E custo por alteração aceita e validada deve ter denominador explícito
    E medições ausentes devem permanecer indisponíveis sem redução de custo fictícia

  @BSH-EXP-009
  Cenário: Preservar entradas suficientes para reproduzir decisões
    Dado um candidato e uma base identificados por conteúdo e commit quando existentes
    Quando a execução é registrada
    Então deve identificar projeto, tarefa, domínio, tecnologia, agente, versão, modelo, prompts e orçamento
    E contratos, políticas, correspondências e adaptadores devem possuir identidade verificável
    E consultas, contexto selecionado, fatos extraídos e decisões devem ser recuperáveis quando aplicáveis
    E snapshots devem permanecer no próprio projeto sem mover ontologias para outro projeto ou diretório global
    E reprodução deve verificar entradas e depender do registro estruturado sem usar a mensagem da interface

  @BSH-EXP-010
  Cenário: Registrar consistência e revalidar mudanças de dados
    Dado fontes com política SNAPSHOT_PINNED, STRICT_IMMUTABLE ou REVALIDATE_ON_DECISION
    Quando os dados mudam durante a avaliação
    Então SNAPSHOT_PINNED deve usar os bytes congelados identificados
    E STRICT_IMMUTABLE deve impedir reprodução ou decisão com fonte divergente
    E REVALIDATE_ON_DECISION deve executar nova avaliação antes de reutilizar decisão
    E a revalidação e a nova identidade da fonte devem ser registradas

  @BSH-EXP-011
  Cenário: Analisar pares com agrupamento e desagregação
    Dado observações pareadas por tarefa e projeto sob controles equivalentes
    Quando o efeito de condições é estimado
    Então deve apresentar diferença pareada, tamanho de efeito e intervalo de confiança
    E reamostragem deve preservar agrupamento por projeto e tarefa
    E pares incompletos ou controles divergentes devem possuir diagnóstico
    E resultados devem ser desagregados por domínio, tecnologia, modelo e etapa de falha
    E dados insuficientes não devem produzir intervalo de confiança fictício

  @BSH-EXP-012
  Cenário: Contabilizar transferência entre projetos
    Dado registros de adaptação de conhecimento entre projetos
    Quando a transferência é avaliada
    Então artefatos de conhecimento reaproveitado devem possuir identidade e origem
    E esforço de adaptação, revisão, preparação e manutenção deve ser registrado
    E conhecimento não deve ser considerado transferível sem a configuração soberana do projeto de destino
    E falta de medições deve ser declarada sem estimativa inventada de economia

  @BSH-EXP-SPARQL-001
  Cenário: Consultar grafo local em modo somente leitura com limites reais
    Dado consultas SELECT ou ASK e um dataset RDF local
    Quando o módulo de consulta geral executa a consulta
    Então deve suportar junções, filtros e caminhos de propriedade com resultados RDF tipados
    E deve rejeitar atualizações, SERVICE e acesso a fontes remotas
    E deve impor timeout cancelando a execução isolada e limitar resultados
    E a biblioteca e seu contrato de runtime devem ser documentados com fontes primárias e Context7 quando disponível
