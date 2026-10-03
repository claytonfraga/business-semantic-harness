# language: pt
@jornada-17 @adversarial @segregacao @shacl
Funcionalidade: Jornada 17: Fraude de Segregação de Funções e Lotação Incompatível

  Como um arquiteto sênior de QA atuando em perspectiva destrutiva
  Eu quero tentar submeter propostas com auto-aprovação de transferência e responsável não lotado no setor
  Para comprovar que o BSH intercepta conflitos de interesse e incompatibilidades organizacionais em tempo real

  Contexto:
    Dado que o binário global "bsh" é executado no projeto piloto "pilot/asset-management"
    E a ontologia soberana de ativos patrimoniais e regras SHACL estão ativas em modo governado

  @BSH-ONT-013 @BSH-EVAL-008
  Cenário: Tentativa de auto-aprovação onde solicitante é o próprio aprovador
    Dado que o usuário está no terminal interativo do BSH com buffer de entrada limpo
    Quando o usuário digita "Transfer asset AST-001 with requester user1 and approver user1"
    E pressiona Enter
    Então a guarda semântica pré-flight do BSH deve interceptar a operação
    E deve apresentar alerta com "Violated shape: TransferShape"
    E deve explicar que o solicitante da transferência não pode ser o aprovador da movimentação
    E o usuário cancela a operação com Escape restaurando o buffer limpo

  @BSH-ONT-014 @BSH-EVAL-008
  Cenário: Tentativa de transferência para custodiante sem lotação no departamento de destino
    Dado que a sessão continua ativa e protegida
    Quando o usuário solicita "Transfer asset AST-001 to Maintenance department with custodian from Finance"
    E pressiona Enter
    Então a regra SPARQL de compatibilidade organizacional deve invalidar a transferência
    E o BSH deve orientar como prosseguir com a lotação correta
    E ao encerrar a sessão com "/exit", os branches principais do Git devem permanecer estritamente intactos
