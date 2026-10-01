# language: pt
Funcionalidade: Jornada 7 - BSH como Cliente MCP Consumindo Context7 na Interface TUI
  Como um desenvolvedor utilizando a interface TUI do BSH
  Eu quero gerenciar servidores MCP com o comando /mcp e pedir à IA para se conectar a ferramentas externas
  Para que o agente descubra e utilize ferramentas de documentação como o Context7 durante o turno

  Cenário: Usuário configura o servidor MCP Context7 na TUI e solicita à IA a consulta documental
    Dado que o projeto piloto "pilot/asset-management" é aberto com o comando compilado "bsh --project pilot/asset-management"
    Quando o usuário digita "/mcp" para inspecionar o status das conexões MCP
    E o usuário digita o comando "/mcp add context7 node test/support/mock-context7-server.mjs"
    Então o BSH estabelece conexão via stdio com o servidor Context7 e registra a ferramenta "context7_search_docs"
    E o feed exibe a confirmação de conexão com a lista de ferramentas ativas
    Quando o usuário envia o prompt "Conecte-se ao MCP Context7 e consulte a documentação sobre regras de validação SHACL"
    Então o agente BSH planeja o turno e aciona a ferramenta externa "context7_search_docs"
    E a chamada de ferramenta e o resultado retornado pelo Context7 são exibidos no feed da TUI
    E o BSH conclui o turno apresentando a explicação fundamentada com base na documentação oficial recuperada
