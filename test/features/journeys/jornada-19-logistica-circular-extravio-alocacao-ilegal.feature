# language: pt
@jornada-19 @adversarial @logistica @extravio @sinistro
Funcionalidade: Jornada 19: Logística Circular, Sinistro de Extravio e Alocação Ilegal

  Como um arquiteto sênior de QA atuando em perspectiva destrutiva
  Eu quero forçar logística circular, alocação de bens extraviados e sinistros com protocolos inválidos
  Para comprovar a robustez e resiliência da salvaguarda ontológica do BSH sob condições extremas

  Contexto:
    Dado que o binário global "bsh" é executado no projeto piloto "pilot/asset-management"
    E as regras de transporte, incidentes e termos de responsabilidade estão ativas

  @BSH-ONT-018 @BSH-EVAL-008
  Cenário: Tentativa de expedição logística circular com mesma origem e destino
    Dado que o usuário está no terminal interativo do BSH
    Quando o usuário solicita "Dispatch asset AST-001 with origin Headquarters and destination Headquarters"
    E pressiona Enter
    Então o BSH deve disparar a regra de disjunção de "EnvioAtivoShape"
    E deve alertar que a origem deve ser estritamente distinta do destino
    E o usuário cancela a operação com Escape

  @BSH-ONT-019 @BSH-ONT-020 @BSH-EVAL-008
  Cenário: Alocação ilegal de notebook extraviado e protocolo de sinistro fora do padrão regulatório
    Dado que a sessão continua ativa
    Quando o usuário tenta "Allocate lost asset to employee without signed responsibility term"
    E pressiona Enter
    Então o BSH deve barrar a alocação por estado Extraviado proibido e ausência de termo assinado
    Quando o usuário tenta registrar sinistro com "Register lost asset with invalid incident protocol ABC-1234"
    Então o BSH deve exigir formato regulatório SIN-AAAA/NNNNNN
    E o encerramento limpo via "/exit" deve preservar a conformidade e integridade patrimonial
