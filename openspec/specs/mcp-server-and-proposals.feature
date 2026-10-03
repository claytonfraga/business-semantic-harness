# language: pt
# Fontes: src/mcp/server.ts; src/proposals/store.ts; test/mcp/server.test.mjs; test/features/journeys/jornada-06-mcp-servidor-governanca.feature; openspec/changes/mcp-server-cli-integration; openspec/changes/mcp-documentation-in-readme
@bsh @mcps
Funcionalidade: Servidor MCP de governança e propostas locais

  Como um agente externo ou usuário de IDE
  Eu quero consultar regras e submeter propostas por MCP
  Para usar governança sem alterações implícitas no projeto

  @BSH-MCPS-001
  Cenário: Iniciar servidor somente com base pronta
    Dado o comando "bsh mcp --project <caminho>"
    Quando o servidor inicia
    Então deve validar a prontidão da ontologia antes de conectar o transporte stdio
    E base inválida deve impedir a inicialização com código não zero
    E mensagens de diagnóstico não devem corromper o protocolo em stdout

  @BSH-MCPS-002
  Cenário: Publicar ferramentas de leitura comuns
    Dado um servidor MCP BSH
    Quando o cliente consulta as ferramentas
    Então deve encontrar "bsh_query_ontology", "bsh_check_prompt_intent", "bsh_validate_shacl" e "bsh_check_affinity"
    E os esquemas devem declarar argumentos e anotações de leitura

  @BSH-MCPS-003
  Cenário: Consultar ontologia pelo protocolo
    Dado um cliente conectado ao servidor
    Quando chama "bsh_query_ontology" com domínio e IRI opcional
    Então deve receber o resultado com proveniência verificável
    E a consulta deve ser registrada na sessão quando "BSH_SESSION_DIR" estiver configurado

  @BSH-MCPS-004
  Cenário: Avaliar intenção pelo protocolo
    Dado um prompt e domínio opcionais enviados ao servidor
    Quando "bsh_check_prompt_intent" é chamado
    Então deve retornar a classificação e os detalhes da guarda preventiva
    E essa consulta não deve executar alterações de código

  @BSH-MCPS-005
  Cenário: Validar fatos RDF pelo protocolo
    Dado fatos Turtle e um domínio declarado
    Quando "bsh_validate_shacl" é chamado
    Então deve executar o validador do domínio e retornar conformidade e violações
    E fatos ilegíveis ou domínio inválido devem retornar "isError"

  @BSH-MCPS-006
  Cenário: Consultar afinidade pelo protocolo
    Dado um domínio do projeto
    Quando "bsh_check_affinity" é chamado
    Então deve retornar classificação, pontuação e conceitos encontrados ou ausentes
    E domínio inexistente deve produzir erro

  @BSH-MCPS-007
  Cenário: Publicar ferramentas específicas de modo governado
    Dado um servidor iniciado com "--governed"
    Quando as ferramentas são listadas
    Então deve expor "bsh_report_conflict" e "bsh_propose_patch"
    E essas ferramentas não devem aplicar nem autorizar mudanças diretamente
    E "bsh_propose_observation" deve pertencer ao modo alternativo

  @BSH-MCPS-008
  Cenário: Relatar conflito sem mutação
    Dado domínio, pedido, regras conflitantes e motivo
    Quando "bsh_report_conflict" é chamado
    Então deve retornar estado "submitted" e digest SHA-256
    E deve registrar alerta quando houver diretório de sessão
    E a ferramenta não deve alterar arquivos de código ou conceder aprovação

  @BSH-MCPS-009
  Cenário: Submeter patch sem aplicá-lo
    Dado uma proposta com domínio, resumo e um arquivo contendo caminho, hash anterior ou null e conteúdo
    Quando "bsh_propose_patch" é chamado
    Então deve retornar estado "submitted" e digest da proposta
    E não deve escrever o conteúdo no projeto
    E revisão externa à chamada deve continuar necessária

  @BSH-MCPS-010
  Cenário: Registrar observação pendente com evidência
    Dado domínio declarado, IRI, conteúdo candidato e trecho de arquivo verificável
    Quando "bsh_propose_observation" é chamado
    Então deve criar uma proposta "pending" em ".bsh/local/proposals/<id>.json"
    E deve incluir identificador, data, evidência e digest da ontologia
    E a ontologia aprovada deve permanecer intacta

  @BSH-MCPS-011
  Cenário: Rejeitar evidência não verificável
    Dado domínio desconhecido, trecho vazio, trecho ausente no arquivo ou caminho externo
    Quando uma observação é submetida
    Então deve ser rejeitada com diagnóstico
    E não deve criar uma proposta aceita nem modificar a ontologia

  @BSH-MCPS-012
  Cenário: Documentar integração de clientes externos
    Dado a documentação pública do BSH
    Quando um usuário configura uma IDE ou cliente MCP
    Então deve encontrar exemplos de execução global e por npx
    E deve encontrar configurações para Claude Desktop e Cursor
    E o catálogo deve distinguir ferramentas por modo de operação
