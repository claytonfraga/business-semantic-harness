# language: pt
# Fontes: src/ontology; src/governance/domainRegistry.ts; src/vocabulary/bsh.ts; test/ontology; test/governance/domainRegistry.test.mjs
@bsh @ont
Funcionalidade: Validação e consulta da base ontológica

  Como um responsável pela governança
  Eu quero validar e consultar ontologias com proveniência
  Para tomar decisões sobre regras formais e uma base estável

  @BSH-ONT-001
  Cenário: Interpretar RDF local
    Dado um documento JSON-LD e um conjunto de shapes Turtle
    Quando o BSH carrega os documentos
    Então deve preservar classes, propriedades, relações e políticas no grafo RDF
    E deve rejeitar JSON ou Turtle malformado com diagnóstico explícito

  @BSH-ONT-002
  Cenário: Rejeitar contextos remotos
    Dado um JSON-LD que solicita um contexto remoto
    Quando o documento é interpretado
    Então o carregador deve rejeitar o contexto antes de qualquer acesso à rede
    E deve identificar a URL rejeitada

  @BSH-ONT-003
  Cenário: Distinguir validade de prontidão
    Dado um projeto com manifesto estruturalmente válido e domínios incompletos
    Quando o BSH valida o projeto
    Então deve distinguir "ok" de "ready"
    E ausência de domínio, conceito de negócio ou regra ativa deve impedir prontidão
    E a CLI "bsh ontology validate" deve retornar 1 enquanto houver problemas

  @BSH-ONT-004
  Cenário: Exigir versão ontológica compatível
    Dado um domínio declarado no manifesto
    Quando sua ontologia é validada
    Então deve existir exatamente uma versão de domínio compatível com a versão do manifesto
    E essa versão deve pertencer à família "1.x"
    E divergência ou ausência deve ser relatada

  @BSH-ONT-005
  Cenário: Exigir conceitos e regras ativas
    Dado um domínio selecionado
    Quando sua prontidão é avaliada
    Então deve declarar pelo menos uma classe "rdfs:Class" ou "owl:Class"
    E deve possuir shape com classe alvo e restrição ativa ou política aplicável de revisão humana
    E uma política humana deve possuir "bsh:governs" e "bsh:requiresHumanReview" verdadeiro

  @BSH-ONT-006
  Cenário: Validar estrutura de shapes
    Dado um NodeShape com propriedades
    Quando a validação estrutural é executada
    Então cada propriedade deve possuir exatamente um "sh:path"
    E "sh:minCount" deve ser um literal inteiro não negativo
    E erros do grafo SHACL devem impedir prontidão

  @BSH-ONT-007
  Cenário: Rejeitar conflitos entre domínios
    Dado um manifesto com múltiplos domínios
    Quando todos os domínios são validados
    Então IRI bases duplicadas devem ser relatadas
    E uma mesma IRI com definições incompatíveis deve produzir erro
    E referências locais de "bsh:governs" sem definição devem ser rejeitadas

  @BSH-ONT-008
  Cenário: Executar SHACL Core e SPARQL
    Dado um grafo candidato e shapes locais
    Quando a validação de dados é executada
    Então o resultado deve indicar "conforms"
    E cada violação deve incluir shape, nó de foco, mensagem e severidade
    E deve identificar o mecanismo como "SHACL_CORE", "SHACL_SPARQL" ou "UNKNOWN"

  @BSH-ONT-009
  Cenário: Descobrir domínios do projeto
    Dado um manifesto com domínios ou uma pasta local ".bsh/domains"
    Quando o registro descobre os domínios
    Então deve priorizar as declarações do manifesto e permitir descoberta local alternativa
    E deve apresentar identificador, caminhos, versão disponível e contagens de classes e shapes
    E carregar um domínio desconhecido deve produzir erro

  @BSH-ONT-010
  Cenário: Consultar domínio com proveniência
    Dado um domínio declarado
    Quando o usuário executa "bsh ontology show <dominio>" ou consulta sua IRI
    Então a resposta deve incluir versão, arquivo de origem, declarações, relações e shapes aplicáveis
    E deve indicar políticas de governança e necessidade de revisão humana
    E domínio desconhecido ou IRI sem correspondência deve produzir erro

  @BSH-ONT-011
  Cenário: Congelar retrato ontológico
    Dado um manifesto e seus arquivos de ontologia e shapes
    Quando o BSH cria um retrato
    Então o digest SHA-256 deve considerar caminhos ordenados, tamanhos e conteúdo dos arquivos
    E o retrato e a lista de arquivos devem ser imutáveis
    E uma verificação posterior deve rejeitar alterações de projeto ou digest

  @BSH-ONT-012 @petreo @regra-de-ouro
  Cenário: Desacoplamento absoluto do BSH e residência soberana da ontologia no projeto
    Dado qualquer projeto governado ou operado pelo BSH
    Quando o BSH inicia, descobre, valida ou aplica regras ontológicas
    Então o motor e o pacote BSH não devem ser acoplados a nenhuma ontologia de domínio específica
    E toda e qualquer ontologia de negócio deve residir estritamente no diretório do seu respectivo projeto em "<projeto>/.bsh/domains/<dominio>/"
    E nenhuma ontologia de domínio deve residir no pacote BSH, em diretórios globais ou embutida no binário
    E a implementação de qualquer nova ontologia pelo usuário deve ocorrer criando sua pasta e arquivos no projeto correspondente
    E o BSH deve carregar e aplicar dinamicamente a ontologia ativa a partir do projeto informado

  @BSH-ONT-013
  Cenário: Consolidação dos pacotes de domínio e externalização de heurísticas
    Dado um pacote de domínio versionado com ontologia, shapes, políticas e regras
    Quando o BSH carrega os domínios configurados para o projeto
    Então regras e aliases de vocabulário devem pertencer ao respectivo pacote de domínio e não ao código do motor
    E ontologia, shapes, políticas e correspondências devem possuir identidade e versão recuperáveis
    E o suporte a um domínio não deve implicar suporte automático a qualquer linguagem
    E compatibilidade e dependências entre pacotes devem ser declaradas
    E incompatibilidades entre pacotes devem produzir diagnóstico antes da execução governada
    E operações compostas devem identificar relações entre conceitos, estados e unidades
    E consultas SPARQL com perguntas de competência devem validar os resultados esperados

  @BSH-ONT-PROFILE-001
  Cenário: Declarar o perfil semântico operacional sem confundir seleção com o motor
    Dado o perfil público de validação e um grafo candidato independente
    Quando o BSH informa suas capacidades
    Então a seleção por operação deve declarar correspondência exata de sh:targetClass
    E a completude deve declarar que exige fatos observados para caminhos IRI diretos com sh:minCount positivo em propriedades imediatas
    E caminhos complexos, alternativas e restrições aninhadas devem ser validados pelo motor SHACL sem alegar análise geral de completude
    E o motor deve preservar alvos de classe, nó, sujeitos e objetos, caminhos, alternativas lógicas e restrições aninhadas de SHACL Core e SHACL-SPARQL
    E não deve alegar inferência RDF/OWL geral nem materializar fatos ausentes
    E deve declarar a resolução de subclasses presentes no grafo de shapes pelo motor
    E consultas gerais SPARQL devem permanecer distintas de restrições SHACL-SPARQL
    E ausência de fato obrigatório no candidato deve resultar em indeterminação sem aprovação automática

  @BSH-ONT-EXECUTION-001
  Cenário: Registrar execução real e atribuir violações por identidade estruturada
    Dado múltiplos shapes incluindo um sem alvos no candidato
    Quando o motor valida restrições distintas
    Então shapes selecionados devem permanecer distintos dos shapes efetivamente exercitados
    E a evidência de execução deve identificar shape de origem, shapes ancestrais, declarações de alvo, nó de foco e componente de restrição
    E cada violação deve preservar o identificador estruturado do shape de origem e do componente
    E mensagens iguais não devem alterar a associação de uma violação
    E detalhes de ramos lógicos devem compor evidência sem virar violações independentes do resultado principal
    E ausência de restrição exercitada não deve indicar validação concluída
