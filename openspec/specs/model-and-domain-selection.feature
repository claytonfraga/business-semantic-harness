# language: pt
# Fontes: src/tui/modals.ts; src/tui/fuzzySearch.ts; src/tui/session.ts; test/tui/modals.test.mjs; openspec/changes/openrouter-model-search-and-switch; openspec/changes/advanced-ux-reasoning-diff-multiline-fuzzy; test/features/journeys/jornada-05-busca-e-troca-modelos.feature
@bsh @select
Funcionalidade: Seleção de modelos e domínios

  Como um usuário do BSH
  Eu quero buscar e alternar modelos e ontologias
  Para ajustar a sessão preservando seleções ao cancelar

  @BSH-SELECT-001
  Cenário: Buscar modelos no catálogo real
    Dado o catálogo retornado pelo OpenRouter
    Quando o usuário abre "/model", "/model <consulta>" ou "Ctrl+M"
    Então deve buscar por identificador, nome ou descrição sem diferenciar maiúsculas
    E a busca deve ranquear correspondências por relevância e mostrar até 12 resultados
    E deve identificar o modelo atual e sua janela de contexto

  @BSH-SELECT-002
  Cenário: Selecionar modelo por número ou identificador
    Dado resultados de busca disponíveis
    Quando o usuário informa um índice válido ou identificador exato do catálogo
    Então o modelo ativo deve ser atualizado
    E a preferência deve ser salva somente se a seleção mudou

  @BSH-SELECT-003
  Cenário: Cancelar seleção de modelo com segurança
    Dado o modal de modelos aberto
    Quando o usuário envia entrada vazia, "q", "cancel" ou "exit"
    Então o modal deve fechar preservando o modelo atual
    E nenhuma preferência de modelo deve ser sobrescrita

  @BSH-SELECT-004
  Cenário: Tratar busca sem resultados
    Dado uma consulta que não corresponde ao catálogo
    Quando a lista é renderizada
    Então deve informar ausência de resultados
    E deve permitir nova consulta ou cancelamento sem mudar o modelo

  @BSH-SELECT-005
  Cenário: Ranquear busca difusa sem interpretar regex
    Dado uma consulta com múltiplos termos, pontuação ou caracteres de expressão regular
    Quando a busca difusa é executada
    Então deve procurar subsequências por termo sem exigir ordem dos termos
    E deve favorecer limites de palavra e caracteres consecutivos
    E deve destacar caracteres encontrados sem corromper o texto ANSI

  @BSH-SELECT-006
  Cenário: Selecionar domínio e carregar regras
    Dado domínios disponíveis no projeto
    Quando o usuário usa "/domain" ou "Ctrl+D" e seleciona número ou identificador
    Então o domínio deve ser carregado com ontologia e shapes
    E a preferência e a afinidade devem ser atualizadas
    E entrada vazia deve preservar o domínio atual quando existente

  @BSH-SELECT-007
  Cenário: Informar ausência de domínio
    Dado um projeto sem domínios disponíveis
    Quando a seleção é aberta
    Então deve explicar o modo "UNGOVERNED"
    E deve orientar "bsh domain add <name>"

  @BSH-SELECT-008 @specified @gap
  Cenário: Preservar busca difusa de domínio especificada
    Dado vários domínios com descrições
    Quando o usuário busca no seletor de domínios
    Então a busca prevista na proposta deve ranquear e destacar correspondências
    E essa capacidade deve ser distinguível da seleção atual por número ou identificador

  @BSH-SELECT-009 @specified @gap
  Cenário: Exibir metadados de modelo previstos
    Dado modelos com preços e limites de contexto
    Quando o seletor apresenta as opções
    Então a janela de contexto e os preços disponíveis devem ser consultáveis
    E metadados ausentes não devem ser inventados
