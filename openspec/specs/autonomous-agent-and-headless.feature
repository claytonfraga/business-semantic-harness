# language: pt
# Fontes: src/agent/agentLoop.ts; src/agent/workspaceContext.ts; src/agent/headless.ts; src/cli.ts; test/agent; test/features/journeys/jornada-08-rolagem-historico-loop-agente.feature; test/features/journeys/jornada-09-agente-codificacao-autonomo.feature; openspec/changes/autonomous-coding-agent
@bsh @agent
Funcionalidade: Agente autônomo e execução sem TUI

  Como um desenvolvedor
  Eu quero solicitar mudanças concretas com continuidade de contexto
  Para obter arquivos alterados, validação e resultado verificável

  @BSH-AGENT-001
  Cenário: Descobrir contexto antes do turno
    Dado um projeto selecionado
    Quando a sessão é preparada
    Então o agente deve receber resumo de nome, descrição disponível, tecnologias, manifestos, scripts e estrutura de diretórios
    E deve receber caminhos reais dos principais arquivos de código
    E deve reconhecer manifestos de Node.js, TypeScript, Java, Python, Rust e Go quando presentes

  @BSH-AGENT-002
  Cenário: Executar ciclo concreto de codificação
    Dado uma solicitação de implementação ou correção
    Quando o agente processa a tarefa
    Então suas diretivas devem exigir localizar, ler, editar e validar o código
    E deve usar ferramentas de escrita para concluir uma mudança solicitada
    E deve apresentar arquivos alterados e resultado objetivo

  @BSH-AGENT-003
  Cenário: Distinguir consulta de pedido de ação
    Dado um prompt de pergunta ou de implementação
    Quando a intenção de ação é classificada
    Então perguntas informativas sem imperativo podem terminar com explicação
    E pedidos imperativos ou alvos de codificação devem seguir o ciclo de ação

  @BSH-AGENT-004
  Cenário: Impedir encerramento prematuro sem edição
    Dado um pedido de ação que ainda não produziu arquivos alterados
    Quando o modelo responde sem novas ferramentas antes do limite de turnos
    Então o loop deve solicitar edição concreta e continuar
    E o limite de turnos deve impedir repetição infinita

  @BSH-AGENT-005
  Cenário: Montar chamadas de ferramenta em streaming
    Dado deltas contendo nome e argumentos fragmentados de chamadas de ferramenta
    Quando o stream é consumido
    Então o loop deve reconstruir cada chamada pelo índice e identificador
    E deve executar as chamadas e devolver resultados vinculados por "tool_call_id"

  @BSH-AGENT-006
  Cenário: Continuar após resultado ou erro de ferramenta
    Dado uma chamada nativa ou externa
    Quando ela termina ou falha
    Então o resultado ou diagnóstico deve entrar na conversa como mensagem de ferramenta
    E o modelo deve poder continuar o turno com esse contexto

  @BSH-AGENT-007
  Cenário: Transmitir conteúdo e mensagens intermediárias
    Dado que o modelo emite texto ou raciocínio antes de ferramentas
    Quando os deltas são recebidos
    Então o texto e o raciocínio devem alcançar os callbacks correspondentes
    E mensagens explicativas intermediárias devem ser exibidas antes da execução das ferramentas

  @BSH-AGENT-008
  Cenário: Reter continuidade entre turnos
    Dado um turno com mensagens do assistente e resultados de ferramentas
    Quando o usuário envia um refinamento
    Então a conversa completa deve continuar disponível
    E o system prompt deve ser reconstruído com o domínio e skills ativos

  @BSH-AGENT-009
  Cenário: Relatar limite e cancelamento
    Dado um turno com limite configurado ou sinal de cancelamento
    Quando o limite é atingido ou a execução é abortada
    Então o resultado deve distinguir conclusão de limite de turnos
    E não deve anunciar uma tarefa incompleta como concluída
    E deve preservar diagnóstico de cancelamento

  @BSH-AGENT-010
  Cenário: Executar prompt direto sem interface
    Dado uma chave válida e projeto selecionado
    Quando o usuário executa "bsh --prompt <instrução>"
    Então o agente deve executar sem TUI com contexto e ferramentas do projeto
    E deve mostrar progresso, resposta, diff e resultado do gate
    E deve encerrar com código 0 para sucesso e 1 para falha ou violação

  @BSH-AGENT-011
  Cenário: Ler prompt de arquivo
    Dado um arquivo de instruções relativo ao projeto
    Quando o usuário executa "bsh --prompt-file <arquivo>"
    Então o conteúdo deve ser carregado como uma única solicitação
    E uma instrução explícita em "--prompt" deve ter precedência quando ambas as opções forem fornecidas

  @BSH-AGENT-012
  Cenário: Preparar governança e integrações headless
    Dado uma execução sem TUI
    Quando sua configuração é preparada
    Então deve descobrir domínio, carregar o validador, MCP e skills
    E deve emitir alerta preventivo de intenção quando aplicável
    E deve usar worktree isolada quando disponível

  @BSH-AGENT-013 @specified @gap
  Cenário: Promover somente após resultado confirmado
    Dado que uma execução headless solicita promoção automática
    Quando a promoção é tentada
    Então sucesso deve ser anunciado somente se a integração retornar resultado de promoção
    E resultado bloqueado ou falho deve ser exibido como tal
    E o resultado deve permanecer distinguível de conformidade do diff

  @BSH-AGENT-014
  Cenário: Encerrar recursos da execução
    Dado que a execução headless termina normalmente ou com erro
    Quando a finalização ocorre
    Então as conexões MCP e a worktree temporária devem ser encerradas conforme a política da sessão
    E a saída deve esclarecer se mudanças foram promovidas, preservadas ou descartadas
