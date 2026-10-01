# language: pt
Funcionalidade: Jornada 7 - BSH como Cliente MCP Consumindo Servidores de Terceiros
  Como um desenvolvedor utilizando o BSH
  Eu quero que o BSH se conecte a servidores MCP externos (como Context7 para documentação)
  Para que o agente descubra e utilize ferramentas especializadas de terceiros durante a execução

  Cenário: BSH conecta-se a servidor MCP Context7 e invoca ferramenta de busca documental
    Dado que o projeto possui configuração de servidores MCP em ".bsh/mcp.json" com o servidor "context7"
    E o servidor Context7 expõe a ferramenta "context7_search_docs"
    Quando o BSH inicia a sessão com o gerenciador de clientes MCP ativo
    Então o BSH estabelece conexão via stdio com o servidor Context7 e registra a ferramenta "context7_search_docs"
    Quando o usuário envia uma solicitação que requer consulta técnica como "What does SHACL define according to documentation?"
    Então o agente BSH planeja o turno e despacha a chamada para a ferramenta "context7_search_docs" com a query "shacl shapes"
    E o servidor Context7 retorna a documentação técnica relevante
    E o BSH conclui o turno fornecendo a resposta fundamentada com base na documentação recuperada
