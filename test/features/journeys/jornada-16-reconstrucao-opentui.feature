# language: pt
# Requisitos: openspec/specs/opentui-component-tui.feature; menu-de-comandos-barra.feature;
# tui-layout-and-feedback.feature; tui-input-history-and-navigation.feature;
# model-and-domain-selection.feature; prompt-guard-and-governance-mode.feature.

@journey @opentui
Funcionalidade: Jornada da TUI reconstruída com componentes OpenTUI
  Como usuário do BSH empacotado e instalado via npm
  Quero executar os fluxos existentes com o tema GitHub Dark Dimmed
  Para verificar a preservação do comportamento e a substituição da interface manual

  Contexto:
    Dado que o produto global "bsh" corresponde ao pacote da migração avaliado
    E que o projeto selecionado é uma cópia limpa do piloto com sua própria ontologia
    E que a ontologia dessa cópia foi validada antes da sessão
    E que cada execução possui batchId e sessão tmux persistente
    E que a gravação MP4 começa com objetivos em português sobre fundo preto e letras brancas
    E que respostas de um provedor local controlado são identificadas como simulação

  @BSH-OPENTUI-005 @BSH-OPENTUI-014 @BSH-OPENTUI-015
  Cenário: Navegar pela paleta e seletores sem alterar uma escolha cancelada
    Dado que a sessão nativa apresenta modelo e domínio ativos
    Quando o usuário abre a paleta com o prompt vazio
    E filtra comandos, navega com setas e Tab e cancela com Escape
    E abre os seletores de modelo, domínio e skills e cancela cada seleção
    Então nenhum comando cancelado deve ser despachado
    E o foco deve retornar à entrada preservando os estados ativos
    E cores, fundos e destaques devem corresponder às features do tema
    E a captura final e o vídeo devem ser preservados com o batchId

  @BSH-OPENTUI-006 @BSH-OPENTUI-007 @BSH-OPENTUI-010
  Cenário: Manter entrada e fila durante streaming e redimensionamento
    Dado que a sessão nativa recebe conteúdo e raciocínio incrementais do provedor controlado
    Quando o usuário envia uma solicitação e enfileira outra durante a execução
    E alterna o raciocínio com Ctrl+O
    E digita um rascunho enquanto alterna a largura do terminal entre 35, 60, 80 e 140 colunas
    E percorre a conversa com PageUp e PageDown
    Então o conteúdo deve permanecer atualizado e a fila deve executar em ordem FIFO
    E o rascunho e o estado do raciocínio devem ser preservados
    E consulta, seleção e foco de um diálogo aberto devem ser preservados ao alternar essas larguras
    E cabeçalho, rodapé e entrada devem permanecer utilizáveis
    E o histórico persistido deve permitir recuperar as solicitações em uma nova sessão
    E a saída deve restaurar o terminal e liberar os recursos

  @BSH-OPENTUI-008 @BSH-OPENTUI-013
  Cenário: Executar uma mudança nativa conforme com ferramentas reais
    Dado que a cópia do piloto está governada e seu estado inicial foi registrado
    Quando o usuário solicita "Add an English comment explaining the existing transfer validation without changing its rules"
    E o provedor controlado propõe uma alteração de código aderente à ontologia e às shapes
    Então o processo nativo deve executar as ferramentas reais no workspace isolado
    E o arquivo final e o diff devem comprovar a alteração conforme solicitada
    E decisões e alertas de governança devem ser comparados com os resultados esperados
    E o relatório deve distinguir gravação no workspace de promoção para a origem

  @BSH-OPENTUI-008 @BSH-OPENTUI-013
  Cenário: Cancelar uma solicitação conflitante após alerta de governança
    Dado que a cópia do piloto está governada e seu estado inicial foi registrado
    Quando o usuário solicita "Remove the validation and transfer the retired asset without required fields"
    Então a TUI deve apresentar o alerta e aguardar a decisão do usuário
    Quando o usuário cancela com Escape
    Então a solicitação cancelada não deve produzir uma chamada ao modelo nem alterar arquivos
    E perguntas, decisão de cancelamento e estado final devem ser preservados como evidência

  @codex @codex-smoke @BSH-LEGACY-001 @BSH-OPENTUI-013
  Cenário: Registrar a execução obrigatória do adaptador Codex ou seu bloqueio antes do primeiro turno
    Dado que foram planejadas a mudança conforme e a mudança conflitante dos cenários anteriores
    Quando "bsh codex" é iniciado a partir da cópia limpa do piloto validado em tmux
    Então se o adaptador iniciar deve receber as solicitações reais e tentar modificar a cópia
    E se recusar iniciar ambos os casos devem ser registrados como bloqueados antes do primeiro turno
    E a sessão nativa OpenRouter não deve substituir o resultado do adaptador
    E vídeo, captura final, diagnóstico e relatório devem usar o batchId

  @BSH-EVAL-001 @BSH-OPENTUI-013
  Cenário: Preservar evidências e limites da avaliação
    Dado que foram coletados estados, entradas, ações, decisões e arquivos finais
    Quando a execução for encerrada
    Então o relatório datado deve registrar resultados observados, limitações e correções propostas
    E vídeos e capturas finais devem ser preservados localmente e copiados para Downloads quando autorizado pelo sistema de arquivos
    E cada cópia deve possuir SHA-256 idêntico ao artefato local
    E despesas e economia de tokens devem apresentar valores absolutos e percentuais somente quando medidos
    E medidas ausentes devem ser registradas como indisponíveis sem usar contadores simulados como evidência
    E todas as sessões persistentes devem ser encerradas
