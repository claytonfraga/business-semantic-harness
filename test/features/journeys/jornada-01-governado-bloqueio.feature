# language: pt
Funcionalidade: Jornada 1 - Sessão Governada com Bloqueio de Violação SHACL
  Como um desenvolvedor ou operador de negócio
  Eu quero que o BSH execute sob governança semântica com o harness ativo
  Para que alterações violadoras de regras de negócio sejam bloqueadas antes da promoção

  Cenário: Tentativa de transferir ativo baixado sem justificativa com bloqueio semântico
    Dado que o projeto piloto "pilot/asset-management" possui ontologia "ativos" com SHACL ativo
    E o BSH é iniciado com o comando "bsh --project pilot/asset-management"
    Quando o usuário digita no prompt "Transfer retired asset AST-002 to Maintenance department without justification"
    Então o BSH Agent analisa o código no worktree Git isolado
    E o Gate Semântico avalia os fatos RDF contra as restrições da forma "TransferShape"
    E o Gate Semântico detecta a violação e reporta "[X] VIOLATION"
    E a promoção para a branch de origem é bloqueada
    E o repositório principal permanece íntegro e inalterado
