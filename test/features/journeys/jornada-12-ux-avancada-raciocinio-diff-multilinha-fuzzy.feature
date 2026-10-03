# language: pt
Funcionalidade: Jornada 12 - UX Avançada com Raciocínio CoT Retrátil, Diff em Tempo Real, Modo Multilinha e Busca Difusa
  Como um desenvolvedor sênior operando o BSH com modelos de fronteira e raciocínio profundo
  Eu quero que o raciocínio preliminar seja colapsado por padrão para economizar espaço de tela
  E quero acompanhar visualmente as modificações em arquivos em tempo real via diff preview
  E quero poder colar código ou especificações multilinha diretamente no terminal
  E quero localizar modelos e ontologias com correspondência difusa e destaque de caracteres

  Cenário: Colapso e expansão interativa do bloco de raciocínio CoT
    Dado que um modelo de raciocínio profundo ("deepseek-r1" ou "gemini-thinking") emite cadeia de pensamento
    Quando o raciocínio é concluído e a resposta textual começa a ser emitida
    Então o bloco de raciocínio é automaticamente recolhido para uma linha sintética
    E exibe "▼ [Reasoning: ~N tokens · Xs] [Ctrl+O expand]"
    E quando o usuário pressiona "Ctrl+O"
    Então o bloco é expandido exibindo todo o raciocínio preliminar com margem magenta
    E a moldura da TUI preserva a altura total estritamente invariante

  Cenário: Atualização incremental de diff em tempo real durante chamadas de ferramentas
    Dado que o agente está aplicando uma modificação de código que envolve múltiplos arquivos
    Quando a ferramenta "replace_file_content" ou "write_to_file" conclui a alteração de um arquivo
    Então um card de preview de diff "diff_preview" é exibido ou atualizado no chat
    E exibe os arquivos alterados com seus balanços de linhas adicionadas e removidas
    E quando o turno é completamente finalizado
    Então o card efêmero é substituído pelo recibo oficial de implementação com auditoria semântica

  Cenário: Captura de prompt multilinha com delimitador """
    Dado que o usuário deseja enviar uma especificação complexa ou trecho de código
    Quando o usuário inicia a entrada com '"""'
    Então o terminal entra em modo de captura de bloco multilinha exibindo '...'
    E quando o usuário finaliza a entrada com '"""'
    Então todas as linhas acumuladas são submetidas como uma instrução única e indivisível

  Cenário: Invocação de editor externo com /editor
    Dado que o usuário prefere redigir seu prompt em seu editor de texto de terminal favorito
    Quando o usuário digita "/editor" no campo de entrada
    Então o BSH abre o editor configurado em $VISUAL ou $EDITOR com arquivo temporário
    E ao salvar e fechar o editor o conteúdo digitado é injetado como prompt do usuário

  Cenário: Busca difusa com caracteres especiais e tolerância a permutação de termos
    Dado que o usuário aciona o modal de seleção de modelos através de "Ctrl+M"
    Quando o usuário digita uma busca com termos fora de ordem ou caracteres de pontuação
    Então o algoritmo de correspondência difusa ranqueia os modelos correspondentes
    E realça visualmente os caracteres coincidentes em amarelo negrito
    E permite a seleção direta pelo índice numérico ou cancelamento com Enter/q
