# language: pt
Funcionalidade: Jornada 15 - Menu Interativo de Comandos de Barra no Prompt do BSH

  Como um usuário da TUI do BSH
  Eu quero que ao digitar "/" em um prompt vazio apareça um menu com todos os comandos disponíveis e suas descrições
  Para descobrir e acionar funcionalidades do sistema com rapidez e sem memorizar sintaxes

  Contexto:
    Dado que a sessão interativa da TUI do BSH está aberta e pronta
    E que a linha de entrada do usuário está completamente vazia

  Cenário: Abertura do menu de comandos ao digitar "/" no prompt vazio
    Quando o usuário pressiona a tecla "/" no prompt vazio
    Então o sistema deve abrir imediatamente o menu de comandos de barra
    E o menu deve listar os comandos essenciais incluindo "/model", "/domain", "/diff", "/skills" e "/exit"
    E cada item deve apresentar seu nome em destaque e a descrição do que ele faz

  Cenário: Não acionamento do menu quando a tecla "/" for digitada com texto já existente
    Dado que o usuário já digitou o texto "crie um endpoint para "
    Quando o usuário pressiona a tecla "/"
    Então o caractere "/" deve ser adicionado como texto comum na linha de entrada
    E nenhum menu modal deve ser exibido

  Cenário: Navegação entre opções com cores ativas exclusivas e opção de não selecionar
    Dado que o menu de comandos de barra está aberto
    Quando o usuário navega com a seta para baixo passando pelas opções do menu
    Então cada opção em foco deve ser destacada com uma cor exclusiva e diferente da anterior
    Quando o usuário decide não selecionar nenhuma opção e pressiona a tecla "Escape"
    Então o menu deve ser fechado imediatamente sem despachar comandos
    E o usuário permanece no prompt original limpo

  Cenário: Filtro e seleção de comando no menu
    Dado que o usuário abre novamente o menu de comandos de barra com "/"
    Quando o usuário digita "ex"
    Então a lista deve exibir apenas as opções correspondentes como "/exit" com realce de caracteres
    Quando o usuário confirma a opção "/exit" com Enter
    Então o sistema deve executar o comando correspondente e encerrar a sessão limpando a tela

