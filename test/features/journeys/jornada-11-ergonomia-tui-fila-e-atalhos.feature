# language: pt
Funcionalidade: Jornada 11 - Ergonomia TUI, Fila Concorrente de Prompts e Atalhos de Teclado
  Como um engenheiro de software operando o BSH continuamente
  Eu quero que o terminal gerencie entradas concorrentes em fila FIFO sem perda de dados
  E quero atalhos imediatos para cancelamento com duplo Escape e limpeza com Ctrl+C
  Para que a experiência seja fluida, ágil e compatível com as melhores ferramentas de IA CLI

  Cenário: Enfileiramento de prompts concorrentes durante a execução do agente
    Dado que uma sessão interativa do BSH está processando um turno com ferramentas ativas
    Quando o usuário digita e envia um segundo prompt antes da conclusão do primeiro
    Então o segundo prompt não bloqueia nem corrompe a interface do terminal
    E o prompt é inserido no histórico com o distintivo "[QUEUED]"
    E o rodapé atualiza o contador dinâmico de fila "[Queue: 1]"
    E quando o turno atual é finalizado
    Então o próximo prompt da fila é imediatamente processado em ordem FIFO
    E o distintivo "[QUEUED]" é removido da entrada de chat correspondente

  Cenário: Cancelamento imediato de turno por Duplo Escape (ESC ESC)
    Dado que o modelo ou ferramentas do BSH estão em execução longa no workspace
    Quando o usuário pressiona a tecla "ESC" duas vezes em menos de 500 milissegundos
    Então a execução assíncrona é imediatamente abortada via sinal do AbortController
    E o BSH adiciona a mensagem "[!] Execução cancelada pelo usuário (ESC ESC)." no chat
    E o prompt é liberado imediatamente sem travamentos ou reinício de processo
    E se houver prompts remanescentes na fila o próximo é consumido normalmente

  Cenário: Limpeza instantânea do buffer de digitação com Ctrl+C
    Dado que o usuário digitou um texto preliminar incompleto no campo de prompt
    Quando o usuário pressiona "Ctrl+C"
    Então o buffer do componente de entrada da TUI é limpo para uma string vazia
    E o cursor retorna à posição inicial da linha de prompt
    E a sessão interativa do BSH permanece viva e operante sem sair para o shell

  Cenário: Telemetria de tempo e taxa de geração (TPS) no rodapé
    Dado que um turno de geração de código foi finalizado pelo agente
    Quando a barra de status inferior é repintada
    Então o rodapé exibe o tempo decorrido e a taxa de tokens por segundo calculada
    E mantém invariante a altura e largura exata da moldura do terminal
