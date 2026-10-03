# language: pt
Funcionalidade: Paleta Flutuante de Comandos Slash no Padrão OpenTUI

  Como um engenheiro de software operando a interface TUI do BSH
  Eu quero uma paleta flutuante e ergonômica de comandos no padrão OpenTUI ao digitar "/" com o prompt vazio
  Para descobrir e acionar comandos do harness com facilidade, navegação por rolagem de janela, cores exclusivas por comando e descrições concisas sem quebrar o layout do terminal

  Contexto:
    Dado que a sessão interativa da TUI do BSH está inicializada e ociosa
    E que a linha de entrada do prompt está estritamente vazia

  @BSH-MENU-001
  Cenário: Exibição instantânea da paleta de comandos flutuante OpenTUI em prompt vazio
    Dado que o prompt de entrada está estritamente vazio
    Quando o usuário digita o caractere "/"
    Então a paleta flutuante de comandos deve abrir imediatamente acima do prompt sem limpar a tela
    E a paleta deve ser limitada a no máximo 72 colunas de largura para evitar quebra de linha no terminal
    E a paleta deve apresentar uma janela rolável de opções com cabeçalho indicando "(1-5 of 15) • ↑/↓ scroll"
    E cada linha de comando deve exibir:
      | Campo | Especificação |
      | Nome do Comando | Prefixo com "/" em destaque (ex: /model, /domain, /skills, /diff, /rules, /settings, /verbose, /exit) |
      | Atalho | Identificador do atalho de teclado quando disponível (ex: [Ctrl+M], [Ctrl+D]) |
      | Descrição | Descrição concisa em inglês com até 42 caracteres sem truncamento ou quebra de linha |

  @BSH-MENU-002
  Cenário: Preservação do caractere "/" como texto literal quando o prompt já contiver texto
    Dado que o usuário já digitou texto no prompt de entrada como "analisar a rota /api/v1/auth"
    Quando o usuário pressiona a tecla "/"
    Então o caractere "/" deve ser tratado como texto literal comum
    E nenhuma paleta de comandos ou modal deve ser disparado
    E o cursor deve avançar normalmente no buffer de edição

  @BSH-MENU-003
  Cenário: Filtragem instantânea de comandos por busca
    Dado que a paleta de comandos slash está aberta
    Quando o usuário digita um termo como "ex" ou "mod"
    Então a lista deve atualizar em tempo real exibindo apenas as opções correspondentes
    E o cabeçalho deve exibir o filtro ativo e o total de correspondências
    E os caracteres correspondentes no nome do comando devem ser realçados

  @BSH-MENU-004
  Cenário: Navegação interativa com rolagem de janela e cores GitHub Dark Dimmed exclusivas por comando
    Dado que a paleta de comandos slash está aberta com 15 comandos disponíveis
    Quando o usuário navega entre as opções utilizando as setas direcionais para baixo ou para cima
    Então a janela visível deve rolar suavemente exibindo 5 itens por vez
    E cada opção ativa sob foco deve ser destacada com uma cor exclusiva das escalas GitHub Dark Dimmed:
      | Comando | Cor Ativa Exclusiva |
      | /model | #b083f0 |
      | /domain | #57ab5a |
      | /skills | #96d0ff |
      | /diff | #eac55f |
      | /rules | #6cb6ff |
      | /settings | #f69d50 |
      | /affinity | #4184e4 |
      | /mcp | #986ee2 |
      | /clear | #cdd9e5 |
      | /done | #6bc46d |
      | /help | #539bf5 |
      | /ungoverned | #daaa3f |
      | /governed | #8ddb8c |
      | /verbose | #b392f0 |
      | /exit | #f47067 |
    E a opção ativa deve exibir o ponteiro "❯" enquanto as opções inativas permanecem atenuadas

  @BSH-MENU-005
  Cenário: Cancelamento e decisão de não selecionar sem despachar comandos
    Dado que a paleta de comandos slash está aberta e o usuário navegou pelas opções
    Quando o usuário opta por não selecionar nenhuma opção pressionando "Escape" ou "Backspace" com filtro vazio
    Então a paleta deve fechar imediatamente
    E nenhum comando deve ser despachado para execução
    E o prompt da TUI deve ser restaurado em seu estado limpo original sem resíduos visuais

  @BSH-MENU-006
  Cenário: Seleção e despacho de comando a partir da paleta
    Dado que a paleta de comandos slash está aberta
    Quando o usuário navega até o comando desejado e pressiona "Enter" ou digita seu número ordinal
    Então a paleta deve fechar imediatamente
    E o comando selecionado deve ser despachado e executado pelo BSH

  @BSH-MENU-007
  Cenário: Informar busca sem correspondência
    Dado que a paleta de comandos está aberta
    Quando o usuário digita uma consulta sem correspondência
    Então deve exibir "No match" ou mensagem equivalente em inglês
    E "Enter" não deve despachar um comando inexistente

  @BSH-MENU-008
  Cenário: Navegar ciclicamente sem perder o foco
    Dado que a paleta possui resultados filtrados
    Quando o usuário pressiona seta para cima na primeira opção ou seta para baixo na última
    Então a seleção deve retornar ciclicamente à outra extremidade da lista
    E a opção selecionada deve permanecer visível na janela
    E "Tab" deve permitir avançar a seleção

  @BSH-MENU-009
  Cenário: Editar filtro sem despachar comando
    Dado que a paleta possui um filtro não vazio
    Quando o usuário pressiona "Backspace"
    Então deve remover o último caractere do filtro
    E deve reiniciar seleção e deslocamento da lista
    E não deve executar nenhum comando

  @BSH-MENU-010
  Cenário: Selecionar por dígito apenas sem filtro
    Dado uma paleta sem filtro ativo
    Quando o usuário digita um dígito de 1 a 9 correspondente a uma opção disponível
    Então o comando correspondente deve ser despachado
    E com filtro ativo o dígito deve compor a consulta em vez de selecionar imediatamente

  @BSH-MENU-011
  Cenário: Oferecer seleção alternativa fora de terminal interativo
    Dado que a seleção de comandos não dispõe de entrada TTY compatível
    Quando o seletor alternativo é utilizado
    Então deve oferecer opções numeradas e busca textual
    E deve permitir cancelamento sem despacho
    E a escolha deve retornar o comando selecionado ao chamador
