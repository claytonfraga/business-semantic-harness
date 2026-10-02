# language: pt
Funcionalidade: Menu Interativo de Comandos de Barra no Prompt do BSH

  Como um engenheiro de software operando a TUI do BSH
  Eu quero que ao digitar o caractere "/" com o prompt de entrada vazio seja exibido um menu interativo com todas as opções disponíveis e suas descrições
  Para descobrir e acionar comandos e ferramentas do harness com facilidade e sem necessidade de memorização prévia

  Contexto:
    Dado que a sessão interativa do BSH está inicializada e aguardando entrada do usuário
    E que a interface TUI está no estado ocioso pronta para receber comandos

  Cenário: Acionamento imediato do menu de comandos de barra em prompt vazio
    Dado que a linha de entrada do prompt está estritamente vazia
    Quando o usuário pressiona a tecla "/"
    Então o sistema deve abrir imediatamente o menu de comandos de barra sem exigir a tecla Enter
    E o menu deve apresentar a lista de todos os comandos disponíveis no BSH
    E cada opção deve exibir:
      | Campo | Descrição |
      | Nome do Comando | Prefixo com "/" em destaque (ex: /model, /domain, /skills, /diff, /rules, /settings, /mcp, /exit) |
      | Descrição | Explicação clara do que o comando faz ou contém |
      | Atalho de Teclado | Atalho rápido associado quando existente (ex: Ctrl+M, Ctrl+D) |
      | Categoria | Classificação funcional (Governança, Configuração, Sistema, Skills, Interface) |

  Cenário: Preservação do caractere "/" como texto literal quando o prompt não estiver vazio
    Dado que o usuário já digitou texto no prompt de entrada como "analisar o módulo /src/core"
    Quando o usuário pressiona a tecla "/"
    Então o caractere "/" deve ser tratado como texto literal comum
    E nenhum menu modal deve ser disparado
    E o cursor deve avançar normalmente na linha de edição

  Cenário: Filtragem instantânea e busca difusa de comandos no menu
    Dado que o menu de comandos de barra está aberto
    Quando o usuário digita um termo de busca como "ex" ou "dom"
    Então a lista deve atualizar dinamicamente exibindo apenas as opções correspondentes
    E os caracteres coincidentes devem ser destacados visualmente

  Cenário: Seleção e despacho de comando a partir do menu
    Dado que o menu de comandos de barra está aberto
    Quando o usuário seleciona uma opção através do índice numérico ou navegando com setas e pressionando Enter
    Então o menu deve ser fechado
    E o comando selecionado deve ser despachado imediatamente para execução no BSH

  Cenário: Cancelamento e restauração do prompt limpo
    Dado que o menu de comandos de barra está aberto
    Quando o usuário pressiona a tecla "Escape" ou "q"
    Então o menu de comandos de barra deve ser fechado
    E o buffer do prompt deve retornar ao estado vazio sem resíduos de caracteres
