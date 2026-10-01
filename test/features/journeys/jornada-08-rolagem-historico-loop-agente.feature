# language: pt
Funcionalidade: Jornada 8 - Barra de Rolagem Visual, Histórico de Prompts por Projeto e Execução Concreta do Loop do Agente
  Como um desenvolvedor utilizando o BSH para manutenção contínua de software
  Eu quero navegar pelo histórico de prompts com setas para cima/baixo isoladas por projeto, visualizar a barra de rolagem no chat e rolar o histórico
  E garantir que solicitações de modificação sejam efetivamente executadas no código pelo agente em vez de apenas explicadas teoricamente

  Cenário: Visualização da barra de rolagem e navegação por teclado e rolagem
    Dado que a sessão TUI do BSH contém mais linhas de conversa do que a altura visível da tela
    Quando a tela é renderizada
    Então uma barra de rolagem vertical com indicador de posição e trilha é desenhada na borda direita do viewport
    E ao acionar rolagem (PageUp, PageDown, Shift+Seta ou roda do mouse)
    Então o viewport desloca as mensagens anteriores mantendo alinhamento e largura exata da moldura

  Cenário: Histórico de prompts por projeto acessível por setas
    Dado que o projeto possui histórico persistido em ".bsh/history.json"
    Quando o usuário pressiona a tecla Seta para Cima no campo de prompt
    Então o prompt anterior do projeto é recuperado e exibido no campo de entrada
    E ao pressionar Seta para Baixo o prompt avança em direção ao prompt mais recente
    E ao submeter um novo prompt este é gravado no histórico exclusivo daquele projeto

  Cenário: Loop do agente com execução concreta de modificação de código
    Dado que o usuário solicita uma alteração de código ou transferência de ativo no projeto
    Quando o agente processa a solicitação no loop governado
    Então o agente não se limita a explicar regras ontológicas ou relatar conformidade teórica
    E o agente invoca ferramentas do workspace ("read_file", "replace_file_content", "write_file") para inspecionar e modificar os arquivos reais
    E a conversa retém o histórico completo entre turnos permitindo continuidade imediata
    E o Gate Semântico confirma que modificações concretas foram realizadas no workspace antes da promoção
