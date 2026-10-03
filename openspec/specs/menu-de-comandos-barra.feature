# language: pt
Funcionalidade: Paleta Flutuante de Comandos Slash no Padrão OpenTUI

  Como um engenheiro de software operando a interface TUI do BSH
  Eu quero uma paleta flutuante e ergonômica de comandos no padrão OpenTUI ao digitar "/" com o prompt vazio
  Para descobrir e acionar comandos do harness com facilidade, navegação por rolagem de janela, cores exclusivas por comando e descrições concisas sem quebrar o layout do terminal

  Contexto:
    Dado que a sessão interativa da TUI do BSH está inicializada e ociosa
    E que a linha de entrada do prompt está estritamente vazia

  Cenário: Exibição instantânea da paleta de comandos flutuante OpenTUI em prompt vazio
    Dado que o prompt de entrada está estritamente vazio
    Quando o usuário digita o caractere "/"
    Então a paleta flutuante de comandos deve abrir imediatamente acima do prompt sem limpar a tela
    E a paleta deve ser limitada a no máximo 72 colunas de largura para evitar quebra de linha no terminal
    E a paleta deve apresentar uma janela rolável de opções com cabeçalho indicando "(1-5 of 14) • ↑/↓ scroll"
    E cada linha de comando deve exibir:
      | Campo | Especificação |
      | Nome do Comando | Prefixo com "/" em destaque (ex: /model, /domain, /skills, /diff, /rules, /settings, /exit) |
      | Atalho | Identificador do atalho de teclado quando disponível (ex: [Ctrl+M], [Ctrl+D]) |
      | Descrição | Descrição concisa em inglês com até 42 caracteres sem truncamento ou quebra de linha |

  Cenário: Preservação do caractere "/" como texto literal quando o prompt já contiver texto
    Dado que o usuário já digitou texto no prompt de entrada como "analisar a rota /api/v1/auth"
    Quando o usuário pressiona a tecla "/"
    Então o caractere "/" deve ser tratado como texto literal comum
    And nenhuma paleta de comandos ou modal deve ser disparado
    And o cursor deve avançar normalmente no buffer de edição

  Cenário: Filtragem instantânea de comandos por busca
    Dado que a paleta de comandos slash está aberta
    Quando o usuário digita um termo como "ex" ou "mod"
    Então a lista deve atualizar em tempo real exibindo apenas as opções correspondentes
    E o cabeçalho deve exibir o filtro ativo e o total de correspondências
    E os caracteres correspondentes no nome do comando devem ser realçados

  Cenário: Navegação interativa com rolagem de janela e cores vibrantes exclusivas por comando
    Dado que a paleta de comandos slash está aberta com 14 comandos disponíveis
    Quando o usuário navega entre as opções utilizando as setas direcionais para baixo ou para cima
    Então a janela visível deve rolar suavemente exibindo 5 itens por vez
    E cada opção ativa sob foco deve ser destacada com uma cor exclusiva da paleta ANSI-256:
      | Comando | Cor Ativa Exclusiva |
      | /model | Magenta / Orchid (\x1b[1;38;5;177m) |
      | /domain | Verde Esmeralda (\x1b[1;38;5;48m) |
      | /skills | Ciano Elétrico (\x1b[1;38;5;51m) |
      | /diff | Amarelo Dourado (\x1b[1;38;5;220m) |
      | /rules | Azul Céu (\x1b[1;38;5;75m) |
      | /settings | Laranja Pêssego (\x1b[1;38;5;208m) |
      | /affinity | Turquesa (\x1b[1;38;5;43m) |
      | /mcp | Violeta (\x1b[1;38;5;141m) |
      | /clear | Prata Brilhante (\x1b[1;38;5;253m) |
      | /done | Verde Limão (\x1b[1;38;5;154m) |
      | /help | Azul Royal (\x1b[1;38;5;39m) |
      | /ungoverned | Âmbar Quente (\x1b[1;38;5;209m) |
      | /governed | Menta (\x1b[1;38;5;49m) |
      | /exit | Carmesim (\x1b[1;38;5;196m) |
    E a opção ativa deve exibir o ponteiro "❯" enquanto as opções inativas permanecem atenuadas

  Cenário: Cancelamento e decisão de não selecionar sem despachar comandos
    Dado que a paleta de comandos slash está aberta e o usuário navegou pelas opções
    Quando o usuário opta por não selecionar nenhuma opção pressionando "Escape" ou "Backspace" com filtro vazio
    Então a paleta deve fechar imediatamente
    E nenhum comando deve ser despachado para execução
    E o prompt da TUI deve ser restaurado em seu estado limpo original sem resíduos visuais

  Cenário: Seleção e despacho de comando a partir da paleta
    Dado que a paleta de comandos slash está aberta
    Quando o usuário navega até o comando desejado e pressiona "Enter" ou digita seu número ordinal
    Então a paleta deve fechar imediatamente
    E o comando selecionado deve ser despachado e executado pelo BSH
