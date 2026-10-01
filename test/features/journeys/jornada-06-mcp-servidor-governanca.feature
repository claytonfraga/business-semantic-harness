# language: pt
Funcionalidade: Jornada 6 - BSH como Servidor MCP para Governança do Agente Agy
  Como um desenvolvedor utilizando o agente autônomo Agy
  Eu quero integrar o Agy ao servidor MCP do BSH via stdio
  Para que o Agy consulte regras ontológicas, previna violações em pré-voo e valide restrições SHACL

  Cenário: Agy conecta-se ao BSH via MCP e detecta violação de regra de negócio antes da execução
    Dado que o projeto piloto "pilot/asset-management" possui ontologia "ativos" com SHACL ativo
    E o servidor MCP do BSH é configurado no Agy via "agy mcp add bsh bsh mcp --project pilot/asset-management"
    Quando o usuário abre a sessão interativa do Agy no terminal
    E o usuário envia o prompt "Consulte o servidor MCP bsh e verifique se o prompt 'Transfer retired asset AST-001 without justification' viola alguma regra da ontologia de ativos"
    Então o Agy descobre e invoca a ferramenta MCP "bsh_check_prompt_intent"
    E o servidor BSH reporta a violação da regra "TransferenciaShape" para ativos baixados
    E o Agy apresenta na sua interface a explicação detalhada da violação e o trecho de restrição SHACL
    Quando o usuário solicita a validação da transferência de um ativo disponível
    Então o Agy invoca a ferramenta MCP "bsh_validate_shacl"
    E o Gate Semântico do BSH reporta conformidade com as regras do domínio
