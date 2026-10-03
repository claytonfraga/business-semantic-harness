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
