# language: pt
# Fontes: src/enforcement/promptGuard.ts; src/tui/session.ts; src/tui/modals.ts; test/enforcement/prompt-guard.test.mjs; test/enforcement/promptGuard.test.mjs; test/features/journeys/jornada-01-governado-bloqueio.feature; test/features/journeys/jornada-02-desgovernado-sem-harness.feature; test/features/journeys/jornada-10-guarda-semantica-negacoes-e-linha-unica.feature
@bsh @guard
Funcionalidade: Guarda preventiva de prompts e modos de governança

  Como um desenvolvedor
  Eu quero receber alertas preventivos e controlar a governança
  Para decidir sobre intenção conflitante antes de consumir tokens do modelo

  @BSH-GUARD-001
  Cenário: Detectar transferência de ativo baixado
    Dado um domínio de ativos governado
    Quando o usuário solicita transferência de um ativo "Retired" ou "Baixado"
    Então a guarda deve indicar violação de "TransferShape"
    E deve apresentar regra, explicação e termos reconhecidos

  @BSH-GUARD-002
  Cenário: Detectar nova baixa e ausência de justificativa
    Dado um domínio de ativos governado
    Quando o usuário solicita nova baixa de ativo baixado ou operação sensível sem justificativa ou aprovação
    Então deve receber o alerta correspondente ao estado ou aos campos obrigatórios

  @BSH-GUARD-003
  Cenário: Respeitar negações e limites de palavra
    Dado um domínio de ativos governado
    Quando o usuário pede "remover um ativo nao baixado" ou menciona "not retired"
    Então "remover" não deve ser reconhecido como "mover"
    E a negação do estado baixado deve impedir um falso positivo de transferência de ativo baixado

  @BSH-GUARD-004
  Cenário: Ignorar prompts sem domínio aplicável
    Dado um prompt vazio ou uma sessão sem domínio aplicável à guarda
    Quando a intenção é avaliada
    Então a guarda não deve inventar uma violação de ativos

  @BSH-GUARD-005
  Cenário: Pedir confirmação antes do modelo com explicação negocial clara
    Dado um contrato que exige revisão humana e permite prosseguimento após confirmação
    Quando o prompt é submetido na TUI
    Então deve receber a decisão "HUMAN_REVIEW" e o banner "REQUEST REVIEW REQUIRED"
    E o BSH deve aguardar resposta humana antes de chamar o modelo
    E deve exibir as referências reais recuperadas do contrato e as shapes quando aplicáveis
    E deve explicar a operação de negócio identificada, o motivo ontológico da restrição e caminhos de resolução recomendados

  @BSH-GUARD-006
  Cenário: Cancelar intenção conflitante
    Dado que o BSH aguarda confirmação de um prompt violador
    Quando o usuário pressiona "Escape" ou envia "/cancel", "cancel", "/abort", "q", "esc" ou "escape"
    Então o prompt deve ser cancelado sem chamada ao modelo
    E o histórico de prompts deve ser restaurado após a confirmação

  @BSH-GUARD-007
  Cenário: Prosseguir sem conceder promoção
    Dado que o usuário confirma o prosseguimento permitido pela política de revisão do contrato
    E pode confirmar pressionando "Enter" com o campo vazio enquanto a confirmação está pendente
    Quando o agente inicia a execução
    Então deve continuar no workspace isolado sob governança
    E a confirmação de intenção não deve autorizar automaticamente a promoção de código violador

  @BSH-GUARD-008
  Cenário: Alternar confirmação na TUI
    Dado uma sessão com preferências carregadas
    Quando o usuário altera a confirmação em "/settings" ou "/config"
    Então "BSH_CONFIRM_PROMPT_VIOLATIONS" deve ser salvo no projeto
    E quando desabilitado o alerta pode aparecer sem pausa
    Mas essa preferência não pode dispensar revisão obrigatória nem converter bloqueio ou informação insuficiente em autorização
    E a validação de mudanças deve continuar independente dessa preferência

  @BSH-GUARD-009
  Cenário: Desabilitar harness voluntariamente
    Dado uma sessão governada
    Quando o usuário executa "/ungoverned" ou "/bypass"
    Então o validador da sessão deve ser desativado
    E o cabeçalho deve indicar "UNGOVERNED" e ontologia inativa
    E o agente deve executar sem a guarda ontológica ativa

  @BSH-GUARD-010
  Cenário: Reativar harness
    Dado uma sessão sem validador ativo
    Quando o usuário executa "/governed"
    Então o BSH deve carregar o domínio selecionado e recalcular afinidade
    E sem domínio válido deve explicar como selecionar um domínio
    E não deve anunciar governança ativa quando o carregamento falhar

  @BSH-GUARD-011 @specified @gap
  Cenário: Aplicar atalhos de governança e limpeza especificados
    Dado uma sessão interativa
    Quando o usuário pressiona "Ctrl+G" ou "Ctrl+L"
    Então os atalhos devem executar a alternância de governança e a limpeza previstas na especificação da interface
    E a semântica de "Ctrl+G" deve ser reconciliada com a descrição histórica de revisão de diff

  @BSH-GUARD-012
  Cenário: Triagem heurística de intenção do prompt e diferenciação de testes
    Dado um prompt submetido à triagem prévia
    Quando a intenção é analisada
    Então a interface deve identificar a análise como heurística de intenção e não afirmar consulta ontológica ou execução SHACL não ocorridas
    E pedidos para implementar testes de uma proibição devem ser diferenciados de pedidos para violá-la
    E uma negação local não deve alterar indevidamente a classificação de toda a solicitação
    E a triagem deve registrar mecanismo, resultado e limitações
