# language: pt
Funcionalidade: Jornada 2 - Sessão Desgovernada sem Harness Ontológico
  Como um desenvolvedor executando código livre de regras ontológicas
  Eu quero que o BSH funcione como cliente direto OpenRouter
  Para que comandos arbitrários sejam executados sem restrições SHACL

  Cenário: Execução de solicitação sem validação ontológica em projeto desgovernado
    Dado que o projeto não possui diretório ".bsh/domains" ou foi iniciado com "/ungoverned"
    E o BSH exibe o badge "[o] Ungoverned" no cabeçalho e rodapé
    Quando o usuário digita no prompt "Transfer retired asset AST-002 to Maintenance department without justification"
    Então o BSH processa a solicitação diretamente pelo OpenRouter
    E nenhum Gate Semântico RDF/SHACL é disparado
    E o rodapé exibe o status desgovernado com telemetria ativa
