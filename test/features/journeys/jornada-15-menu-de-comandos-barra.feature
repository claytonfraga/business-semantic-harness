# language: pt
Funcionalidade: Jornada 15 - Paleta Flutuante OpenTUI de Comandos Slash

  Como um usuário interagindo com a interface de terminal do BSH
  Eu quero que uma paleta flutuante de comandos no padrão OpenTUI abra ao digitar "/" no prompt vazio
  Para que eu possa descobrir, navegar, rolar pelas opções e executar comandos com cores distintas e descrições claras

  Contexto:
    Dado que a sessão interativa da TUI do BSH está aberta e ociosa
    E que a linha de entrada do usuário está completamente vazia

  Cenário: Abertura da paleta flutuante OpenTUI no prompt vazio
    Quando o usuário digita "/" no prompt vazio
    Então a paleta flutuante de comandos aparece acima do prompt sem limpar a tela
    E a paleta exibe os comandos com janela de rolagem "(1-5 of 14) • ↑/↓ scroll"
    E cada comando exibe seu nome, atalho e descrição concisa em inglês dentro de 72 colunas

  Cenário: Preservação de "/" como texto literal quando digitado em prompt com conteúdo
    Dado que o usuário já digitou "criar um endpoint para "
    Quando o usuário pressiona a tecla "/"
    Então o caractere "/" é inserido como texto literal na linha de comando
    E nenhuma paleta flutuante é exibida

  Cenário: Navegação com rolagem de janela e cores ativas exclusivas por comando
    Dado que a paleta de comandos slash está aberta
    Quando o usuário navega entre os comandos usando a tecla direcional para baixo
    Então a janela visível rola suavemente através das opções
    E cada comando em foco é destacado com sua cor ANSI exclusiva
    Quando o usuário opta por não selecionar nenhum comando e pressiona "Escape"
    Então a paleta é imediatamente fechada sem executar nenhum comando
    E o prompt retorna ao seu estado limpo original

  Cenário: Filtragem e execução de comando a partir da paleta
    Dado que o usuário reabre a paleta digitando "/"
    Quando o usuário digita "ex"
    Então a paleta filtra em tempo real exibindo correspondências incluindo "/exit"
    Quando o usuário confirma a seleção pressionando "Enter"
    Então a sessão do BSH executa o encerramento seguro e restaura o terminal limpo
