# language: pt
Funcionalidade: Jornada 6 - BSH como Servidor MCP para Governança de Agentes Externos
  Como um desenvolvedor ou agente autônomo externo (Claude Desktop, Cursor, Agy)
  Eu quero me conectar ao BSH através do Model Context Protocol (MCP) via stdio
  Para inspecionar regras de domínio, verificar prompts e validar conformidade SHACL de código

  Cenário: Agente externo consome BSH via MCP para validação ontológica e detecção de violações
    Dado que o projeto piloto "pilot/asset-management" possui ontologia "ativos" com SHACL ativo
    E o BSH é inicializado em modo servidor MCP pelo comando "bsh mcp --project pilot/asset-management"
    Quando o cliente MCP envia uma requisição "tools/list"
    Então o BSH retorna as ferramentas disponíveis: "bsh_query_ontology", "bsh_check_prompt_intent", "bsh_validate_shacl" e "bsh_check_affinity"
    Quando o agente externo invoca a ferramenta "bsh_check_prompt_intent" com a solicitação "Transfer retired asset AST-001 to Finance department without justification"
    Então a ferramenta retorna violação detectada com o detalhe da regra "TransferShape" e alerta de ativo baixado
    Quando o agente externo consulta a ontologia via "bsh_query_ontology" com o IRI "urn:pilot:ativos:Ativo"
    Então o BSH retorna os conceitos e definições da ontologia ativa
    Quando o agente externo invoca a ferramenta "bsh_check_prompt_intent" com a solicitação conforme "Transfer available asset AST-101 to Carlos in Finance department"
    Então a ferramenta retorna que o prompt é conforme e não violador
    Quando o agente externo submete fatos Turtle violadores à ferramenta "bsh_validate_shacl"
    Então o validador SHACL do BSH reporta conformidade falsa e detalha as violações encontradas
    Quando o agente externo submete fatos Turtle conformes à ferramenta "bsh_validate_shacl"
    Então o validador SHACL do BSH reporta conformidade verdadeira autorizando a transição
