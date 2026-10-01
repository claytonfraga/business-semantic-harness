# language: pt
Funcionalidade: Jornada 5 - Busca e Alternância de Modelos no OpenRouter
  Como um usuário do BSH conectado ao OpenRouter
  Eu quero pesquisar modelos do catálogo oficial por termo e explorar opções
  E poder cancelar a busca sem alterar o modelo atual
  Para ter flexibilidade na escolha do modelo de IA

  Cenário: Pesquisa de modelos GPT no OpenRouter com fechamento sem alteração
    Dado que o BSH está ativo com o modelo inicial "deepseek/deepseek-v4.1-flash"
    E o catálogo do OpenRouter foi consultado com modelos reais da API
    Quando o usuário digita o comando "/model gpt"
    Então o modal "Select OpenRouter Model" é exibido com os modelos reais correspondentes a "gpt"
    E a lista exibe modelos como "openai/gpt-4o" e "openai/gpt-4o-mini" com seus respectivos limites de contexto
    Quando o usuário digita "q" para fechar a janela sem selecionar
    Então o modal é encerrado imediatamente
    E o modelo ativo permanece inalterado como "deepseek/deepseek-v4.1-flash"
    E a barra de status do rodapé mantém o modelo original
