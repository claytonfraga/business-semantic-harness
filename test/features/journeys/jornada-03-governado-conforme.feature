# language: pt
Funcionalidade: Jornada 3 - Sessão Governada com Alteração Conforme
  Como um desenvolvedor implementando regras de negócio no projeto
  Eu quero que o BSH valide e aprove alterações aderentes ao SHACL
  Para que mudanças conformes sejam promovidas com segurança auditável

  Cenário: Implementação de transferência conforme para ativo em operação
    Dado que o projeto "pilot/asset-management" possui ontologia "ativos" ativa
    E o ativo "AST-001" está no estado operacional "Em Operação"
    Quando o usuário digita no prompt "Add an endpoint to transfer assets in 'In Operation' state with new owner and location"
    Então o BSH Agent elabora a proposta de alteração respeitando a transição de estado permitida
    E o Gate Semântico avalia as regras SHACL de "TransferShape"
    E todos os checks semânticos passam com "[+]"
    E o Gate Semântico emite "[OK] CONFORMING -> Status: CONFORMING (Ready to promote)"
    E a promoção é autorizada
