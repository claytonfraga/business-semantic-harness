# language: pt
# Fontes: src/mcp/clientManager.ts; src/agent/agentLoop.ts; src/tui/session.ts; test/e2e-live/mcp-client-third-party.e2e.mjs; test/features/journeys/jornada-07-mcp-cliente-terceiros.feature; openspec/changes/third-party-mcp-client
@bsh @mcpc
Funcionalidade: Cliente MCP e ferramentas de terceiros

  Como um usuário do agente BSH
  Eu quero conectar serviços de contexto externos
  Para usar suas respostas no loop de codificação

  @BSH-MCPC-001
  Cenário: Carregar configuração local de servidores
    Dado ".bsh/mcp.json" com seção "mcpServers"
    Quando a sessão carrega integrações
    Então deve aceitar comando, argumentos, ambiente, "readOnly" e "disabled" por servidor
    E configuração ausente ou ilegível deve receber tratamento resiliente
    E servidores desabilitados não devem iniciar

  @BSH-MCPC-002
  Cenário: Conectar via stdio e descobrir ferramentas
    Dado um servidor configurado e disponível
    Quando a conexão é iniciada
    Então deve usar transporte stdio e consultar "listTools"
    E os esquemas das ferramentas devem ser convertidos para o catálogo do modelo
    E o nome deve receber namespace do servidor sem prefixo duplicado

  @BSH-MCPC-003
  Cenário: Isolar falhas de conexão
    Dado múltiplos servidores configurados
    Quando um servidor falha ao conectar
    Então deve emitir um aviso identificando esse servidor
    E os demais servidores e a sessão devem continuar utilizáveis

  @BSH-MCPC-004
  Cenário: Executar ferramenta externa no loop
    Dado uma ferramenta externa descoberta
    Quando o modelo a chama
    Então a chamada deve ser encaminhada ao servidor correto com os argumentos originais
    E o resultado deve voltar ao contexto como mensagem de ferramenta
    E respostas de erro devem produzir diagnóstico recuperável

  @BSH-MCPC-005
  Cenário: Preservar metadados de leitura
    Dado uma ferramenta externa marcada "readOnly"
    Quando ela é registrada
    Então o registro deve preservar essa indicação
    E a indicação não deve ser confundida com bloqueio técnico de mutações externas

  @BSH-MCPC-006 @specified @gap
  Cenário: Manter governança sobre ferramentas externas
    Dado uma ferramenta de terceiros capaz de alterar estado
    Quando o agente tenta executá-la numa sessão governada
    Então a política especificada de governança deve avaliar sua capacidade de mutação
    E a integração de catálogo não deve ser declarada equivalente a interceptação confiável

  @BSH-MCPC-007 @specified @gap
  Cenário: Gerenciar servidores pela TUI
    Dado uma sessão interativa
    Quando o usuário executa "/mcp" ou "/mcp add <nome> <comando> [args]"
    Então deve visualizar ferramentas conectadas ou salvar a configuração em ".bsh/mcp.json"
    E deve tentar conectar o servidor adicionado
    E a mensagem de sucesso deve corresponder à conexão real

  @BSH-MCPC-008 @specified @gap
  Cenário: Remover servidor em runtime
    Dado um servidor conectado
    Quando o usuário executa "/mcp remove <nome>"
    Então a configuração deve ser atualizada
    E o servidor removido e suas ferramentas devem deixar o catálogo ativo

  @BSH-MCPC-009 @specified @gap
  Cenário: Conectar serviço solicitado sem simular integração real
    Dado um usuário solicitando conexão a um serviço de documentação por linguagem natural
    Quando o BSH prepara a integração
    Então deve utilizar a configuração e o servidor pretendidos pelo usuário
    E um servidor de demonstração não deve ser anunciado como conexão real ao serviço externo

  @BSH-MCPC-010
  Cenário: Encerrar conexões ao sair
    Dado servidores MCP conectados
    Quando a sessão termina
    Então os clientes devem ser encerrados e os registros de ferramentas limpos
    E falha de encerramento de um cliente não deve impedir a limpeza dos demais
