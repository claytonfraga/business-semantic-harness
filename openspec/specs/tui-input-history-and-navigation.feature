# language: pt
# Fontes: src/tui/inputQueue.ts; src/tui/history.ts; src/tui/exitGuard.ts; src/tui/session.ts; test/tui; test/features/journeys/jornada-08-rolagem-historico-loop-agente.feature; test/features/journeys/jornada-10-guarda-semantica-negacoes-e-linha-unica.feature; test/features/journeys/jornada-11-ergonomia-tui-fila-e-atalhos.feature; test/features/journeys/jornada-12-ux-avancada-raciocinio-diff-multilinha-fuzzy.feature
@bsh @input
Funcionalidade: Entrada, histórico, fila e navegação da TUI

  Como um desenvolvedor em sessão contínua
  Eu quero controlar prompts e execução por teclado
  Para manter continuidade sem perder entradas nem encerrar acidentalmente

  @BSH-INPUT-001
  Cenário: Persistir histórico por projeto
    Dado prompts submetidos em um projeto
    Quando o histórico é salvo
    Então deve residir em "<projeto>/.bsh/history.json" em ordem cronológica
    E deve guardar no máximo os 1000 prompts mais recentes válidos
    E deve ser carregado do mais recente ao mais antigo para o readline
    E arquivo ausente, inválido ou ilegível deve iniciar histórico vazio

  @BSH-INPUT-002
  Cenário: Navegar histórico em linha única
    Dado prompts anteriores no histórico
    Quando o usuário usa as setas para cima ou para baixo
    Então deve recuperar os prompts na linha de entrada
    E textos longos não devem criar linhas ou prefixos duplicados
    E a posição do cursor e as dimensões do quadro devem permanecer estáveis

  @BSH-INPUT-003
  Cenário: Submeter e limpar prompt
    Dado um texto no campo de entrada
    Quando o usuário pressiona "Enter"
    Então o buffer e o cursor devem ser limpos imediatamente
    E entrada vazia deve ser ignorada fora de confirmação e captura multilinha

  @BSH-INPUT-004
  Cenário: Enfileirar durante execução
    Dado um turno do agente em andamento
    Quando o usuário envia novos prompts
    Então devem entrar numa fila FIFO sem corromper a TUI
    E entradas devem receber indicação visual de fila
    E o rodapé deve mostrar "Queue: N"

  @BSH-INPUT-005
  Cenário: Consumir fila após turno ou cancelamento
    Dado prompts pendentes na fila
    Quando o turno ativo termina ou é cancelado
    Então o próximo prompt deve ser executado automaticamente em ordem FIFO
    E seu distintivo de fila deve ser removido
    E as demais entradas devem permanecer pendentes

  @BSH-INPUT-006
  Cenário: Cancelar por duplo Escape
    Dado uma execução do modelo em andamento
    Quando o usuário pressiona "Escape" duas vezes em até 500 milissegundos
    Então o sinal de cancelamento deve abortar o turno
    E a sessão deve continuar disponível
    E um único Escape fora de confirmação ou menu não deve encerrar a sessão

  @BSH-INPUT-007 @specified @gap
  Cenário: Propagar cancelamento às ferramentas
    Dado uma ferramenta ou comando ainda executando
    Quando o usuário cancela o turno
    Então a execução ativa deve receber cancelamento e liberar recursos
    E a fila deve continuar sem sobreposição de execução cancelada e turno seguinte

  @BSH-INPUT-008
  Cenário: Priorizar limpeza por Ctrl+C
    Dado texto não vazio no prompt
    Quando o usuário pressiona "Ctrl+C"
    Então deve limpar o texto e reposicionar o cursor
    E não deve encerrar o BSH nem acionar confirmação de saída

  @BSH-INPUT-009
  Cenário: Cancelar turno por Ctrl+C
    Dado uma execução ativa com prompt vazio
    Quando o usuário pressiona "Ctrl+C"
    Então deve cancelar o turno sem fechar a sessão

  @BSH-INPUT-010
  Cenário: Confirmar saída com Ctrl+C duplo
    Dado uma sessão ociosa com prompt vazio
    Quando o usuário pressiona "Ctrl+C"
    Então deve aparecer um alerta de confirmação de saída
    Quando pressiona novamente em até 1500 milissegundos
    Então a saída deve ser confirmada
    E após a janela de tempo um novo toque deve apenas reiniciar o alerta

  @BSH-INPUT-011
  Cenário: Restaurar terminal ao sair
    Dado que o usuário executa "/exit", "/quit" ou confirma a saída
    Quando a sessão termina
    Então deve restaurar buffer principal, cursor e estado visual do terminal
    E deve remover listeners de teclado e redimensionamento
    E deve encerrar conexões MCP e limpar a worktree conforme a política de saída

  @BSH-INPUT-012
  Cenário: Acumular bloco multilinha
    Dado que o usuário inicia a entrada com três aspas duplas
    Quando envia linhas adicionais e termina com três aspas duplas
    Então deve acumular as linhas preservando quebras internas
    E deve submeter o bloco como um único prompt
    E aspas internas que não fecham o bloco devem ser preservadas

  @BSH-INPUT-013
  Cenário: Cancelar bloco multilinha
    Dado uma captura multilinha ativa
    Quando o usuário pressiona "Ctrl+C"
    Então deve descartar o buffer do bloco
    E deve retornar à entrada normal sem submeter conteúdo parcial

  @BSH-INPUT-014
  Cenário: Editar prompt externamente
    Dado que o usuário executa "/editor"
    Quando o editor externo é aberto
    Então deve usar "VISUAL", depois "EDITOR" e depois o editor padrão
    E o conteúdo salvo deve virar um único prompt após remover linhas de comentário do modelo inicial
    E arquivo temporário deve ser removido
    E conteúdo vazio deve retornar à sessão sem chamar o agente

  @BSH-INPUT-015 @specified @gap
  Cenário: Preservar requisito de continuação por barra invertida
    Dado que a proposta de UX prevê continuação por barra invertida ao fim da linha
    Quando esse modo de continuação é utilizado
    Então as linhas devem formar uma única instrução
    E essa capacidade deve permanecer registrada separadamente da captura por três aspas

  @BSH-INPUT-016
  Cenário: Mostrar barra de rolagem proporcional
    Dado uma conversa maior que o viewport
    Quando a TUI é renderizada
    Então deve desenhar trilha e indicador vertical na última coluna
    E posição e altura devem refletir conteúdo e deslocamento
    E rolagem deve ser limitada ao início e fim do conteúdo

  @BSH-INPUT-017
  Cenário: Navegar conversa por teclado e comandos
    Dado uma conversa com histórico além da tela
    Quando o usuário usa "PageUp", "PageDown", "Shift+Up", "Shift+Down" ou os comandos de rolagem
    Então deve navegar sem alterar o histórico de prompts
    E "/up", "/down", "/pgup", "/pgdn", "/top" e "/bottom" devem controlar o viewport
    E um novo prompt deve retornar ao conteúdo mais recente

  @BSH-INPUT-018 @specified @gap
  Cenário: Preservar requisito de roda do mouse
    Dado um terminal com suporte à roda do mouse
    Quando o usuário rola a conversa
    Então o viewport deve acompanhar o movimento dentro dos limites
    E o suporte previsto deve ser distinguível dos atalhos de teclado já implementados
