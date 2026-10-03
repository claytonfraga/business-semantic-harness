# language: pt
# Fontes: src/enforcement; src/git/promotion.ts; src/git/finalize.ts; test/enforcement; test/e2e-live/semantic-enforcement.semantic.mjs; test/features/journeys/jornada-03-governado-conforme.feature; test/features/journeys/jornada-09-agente-codificacao-autonomo.feature
@bsh @sem
Funcionalidade: Enforcement independente e gate de promoção

  Como um responsável pela integridade do código
  Eu quero avaliar o estado candidato com SHACL e evidência independente
  Para promover somente candidatos comprovadamente conformes

  @BSH-SEM-001
  Cenário: Reconhecer operações a partir do diff
    Dado regras locais em ".bsh/domains/<dominio>/enforcement.json"
    Quando o diff do candidato é inspecionado
    Então caminho, linhas adicionadas, linhas removidas e remoção de arquivo devem reconhecer as operações configuradas
    E cada operação deve preservar domínio, fatos, proveniência e caminhos relacionados

  @BSH-SEM-002
  Cenário: Preservar origem dos fatos
    Dado fatos observados, inferidos ou indeterminados
    Quando uma operação semântica é representada
    Então cada fato deve preservar propriedade, valor, determinação e origem
    E fatos obrigatórios indeterminados devem impedir conformidade comprovada

  @BSH-SEM-003
  Cenário: Selecionar shapes e políticas por classe
    Dado uma operação reconhecida e um retrato ontológico estável
    Quando o validador semântico seleciona regras
    Então deve localizar shapes por "sh:targetClass" e políticas por "bsh:governs"
    E deve listar shapes selecionadas, executadas e políticas humanas aplicáveis

  @BSH-SEM-004
  Cenário: Agregar resultados conservadoramente
    Dado um lote de operações
    Quando os resultados são agregados
    Então a precedência deve ser violação, indeterminação, revisão humana e conformidade
    E lote vazio, erro ou status desconhecido deve permanecer indeterminado
    E qualquer resultado diferente de conformidade deve bloquear o lote

  @BSH-SEM-005
  Cenário: Exigir candidato estável
    Dado uma sessão com mudanças ainda não estabilizadas em commit
    Quando a governança de promoção é avaliada
    Então deve retornar "INDETERMINATE" no estágio "CANDIDATE_STATE"
    E a promoção deve ser negada

  @BSH-SEM-006
  Cenário: Validar base original e base candidata
    Dado uma sessão governada
    Quando a promoção é avaliada
    Então a base original deve estar pronta e fornecer o retrato de validação
    E mudanças em ".bsh" devem disparar validação da base candidata
    E manifesto removido após o início da sessão ou base inválida devem impedir promoção

  @BSH-SEM-007
  Cenário: Exigir extração independente do candidato
    Dado uma operação reconhecida com shapes aplicáveis
    Quando o gate solicita os fatos
    Então o extrator do host deve fornecer "graphTurtle", "coveredPaths" e "sourceCommit"
    E os fatos devem corresponder ao commit candidato e aos caminhos relevantes
    E declarações do agente não devem substituir essa prova

  @BSH-SEM-008
  Cenário: Cobrir todos os arquivos relevantes
    Dado arquivos alterados no diff
    Quando o gate verifica completude
    Então todos os arquivos devem ser considerados relevantes na ausência de prova confiável de irrelevância
    E arquivos sem cobertura ou operações não reconhecidas devem resultar em "INDETERMINATE"
    E devem aparecer em "missingFacts" ou no diagnóstico de reconhecimento

  @BSH-SEM-009
  Cenário: Exigir foco RDF e fatos obrigatórios
    Dado um grafo candidato para uma operação reconhecida
    Quando a validação é preparada
    Então deve conter um nó tipado com a classe da operação
    E propriedades exigidas por "sh:minCount" devem estar presentes
    E ausência de foco ou fatos deve impedir validação completa

  @BSH-SEM-010
  Cenário: Executar todas as shapes selecionadas
    Dado shapes aplicáveis ao candidato
    Quando o gate decide sobre promoção
    Então "validationExecuted" e "validationComplete" devem ser verdadeiros para aprovação
    E todas as shapes selecionadas devem constar como executadas
    E ausência de execução não deve ser convertida em conformidade

  @BSH-SEM-011
  Cenário: Bloquear violações sem depender do relato do agente
    Dado um candidato que viola uma shape
    E que o agente não chamou "bsh_report_conflict"
    Quando o enforcement independente valida os fatos
    Então deve retornar "VIOLATION" e negar promoção
    E a origem deve permanecer intacta mesmo se os testes técnicos passarem

  @BSH-SEM-012
  Cenário: Bloquear erro e tempo limite de validação
    Dado uma falha de extração, seleção ou execução de SHACL
    Quando o processamento falha ou excede seu limite de tempo
    Então deve retornar "VALIDATION_ERROR" com estágio e motivo
    E a promoção deve ser negada
    E uma violação já encontrada não deve ser ocultada por falha adicional

  @BSH-SEM-013
  Cenário: Separar status semântico de decisão de promoção
    Dado um resultado de governança
    Quando o gate registra a decisão
    Então deve distinguir "CONFORMING", "VIOLATION", "INDETERMINATE" e "VALIDATION_ERROR"
    E deve registrar separadamente decisão de política e decisão de promoção
    E somente conformidade executada e completa deve permitir "ALLOW"

  @BSH-SEM-014
  Cenário: Registrar evidência completa
    Dado um candidato avaliado
    Quando a decisão é preservada
    Então deve incluir operações, shapes, fatos, cobertura, ausências, violações e estágio de falha
    E deve incluir hashes do grafo, da ontologia, das políticas e do candidato
    E deve identificar commits de origem e candidato e indicar se a origem mudou

  @BSH-SEM-015
  Cenário: Exigir nova validação após mudança tardia
    Dado uma decisão favorável já emitida
    Quando candidato, worktree, branch ativa, origem, ontologia ou políticas mudam antes da integração
    Então a promoção deve ser negada com "REVALIDATION_REQUIRED" quando aplicável
    E nenhum candidato diferente do revisado deve ser integrado

  @BSH-SEM-016
  Cenário: Integrar pelo commit validado
    Dado uma decisão favorável ainda válida e gates técnicos aprovados
    Quando a integração é executada
    Então deve usar "merge --ff-only" com o hash imutável do candidato validado
    E o registro deve indicar que a origem foi alterada somente após sucesso Git

  @BSH-SEM-017 @specified @gap
  Cenário: Distinguir ausência de mudanças
    Dado um workspace sem alterações reais
    Quando o diff é avaliado ao fim do turno
    Então deve retornar "NO_CHANGES"
    E deve apresentar diagnóstico de leitura em vez de implementação realizada
    E não deve anunciar uma mudança pronta para promoção

  @BSH-SEM-018
  Cenário: Mostrar evidência coerente na TUI
    Dado um resultado de diff ou intenção violadora
    Quando o cartão de gate é renderizado
    Então status "VIOLATION" deve incluir pelo menos um check de falha
    E checks todos positivos não devem contradizer um status de violação
    E o diagnóstico da TUI não deve substituir a validação independente da promoção

  @BSH-SEM-019
  Cenário: Manter operação sem conhecimento aplicável distinguível
    Dado uma operação sem classe, shape ou política governada aplicável
    Quando o validador de operação a avalia
    Então deve indicar ausência de conhecimento governado sem inventar violação
    E o gate de promoção deve ainda exigir reconhecimento e cobertura do diff

  @BSH-SEM-020
  Cenário: Permitir fluxo Git genérico sem manifesto
    Dado um repositório genérico que nunca teve manifesto BSH na base da sessão
    Quando o módulo Git avalia um candidato estável
    Então o fluxo genérico pode seguir com gates técnicos e identidade Git
    E essa compatibilidade não deve permitir remover um manifesto existente para contornar governança

  @BSH-SEM-021
  Cenário: Separar modo consultivo de enforcement
    Dado uma finalização explicitamente consultiva
    Quando o candidato é avaliado para integração
    Então deve executar gates técnicos e verificações de identidade Git
    E deve registrar "CONSULTATIVE" e ausência de execução do enforcement semântico
    E o relatório não deve alegar bloqueio pelo gate semântico
