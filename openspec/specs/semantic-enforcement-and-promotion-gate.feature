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
  Cenário: Mostrar evidência coerente na TUI com explicação negocial
    Dado um resultado de diff ou intenção violadora
    Quando o cartão de gate é renderizado
    Então status "VIOLATION" deve incluir pelo menos um check de falha
    E checks todos positivos não devem contradizer um status de violação
    E o cartão deve explicar a regra de negócio ontológica violada e ações recomendadas para adequação
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
    E "validationExecuted" deve permanecer falso porque nenhuma validação semântica foi executada

  @BSH-SEM-021
  Cenário: Separar modo consultivo de enforcement
    Dado uma finalização explicitamente consultiva
    Quando o candidato é avaliado para integração
    Então deve executar gates técnicos e verificações de identidade Git
    E deve registrar "CONSULTATIVE" e ausência de execução do enforcement semântico
    E o relatório não deve alegar bloqueio pelo gate semântico

  @BSH-SEM-022 @R7
  Cenário: Avaliar política humana mesmo sem shapes selecionadas
    Dado uma operação reconhecida com política "requiresHumanReview=true"
    E nenhuma shape selecionada para a operação
    Quando o gate avalia o candidato
    Então deve listar a política aplicável e indicar "requerRevisaoHumana" verdadeiro
    E deve retornar "INDETERMINATE" no estágio "POLICY"
    E "policyDecision" e "promotionDecision" devem ser "DENY"
    E "validationExecuted" deve ser falso

  @BSH-SEM-023
  Cenário: Exigir decisão humana registrada e vinculada ao candidato
    Dado uma política que exige revisão humana
    Quando não existe decisão humana confiável registrada e vinculada ao candidato avaliado
    Então a promoção deve permanecer negada mesmo com SHACL conforme
    E aprovação de uma ação, texto do agente ou registro de outro candidato não deve autorizar a promoção
    E enquanto não houver mecanismo de decisão humana vinculada ao candidato o estágio deve ser "POLICY"

  @BSH-SEM-024
  Cenário: Distinguir ausência de shape, política e evidência
    Dado uma operação reconhecida
    Quando nenhuma shape e nenhuma política se aplicam
    Então o gate deve negar promoção no estágio "SHAPE_SELECTION" sem inventar revisão humana
    Mas quando uma shape se aplica e nenhuma política se aplica com fatos independentes completos
    Então a operação pode ser "CONFORMING" com "ALLOW" e lista de políticas vazia
    Mas quando uma shape se aplica e faltam fatos independentes
    Então o gate deve negar promoção no estágio "FACT_EXTRACTION"
    E ausência de evidência não deve apagar políticas aplicáveis

  @BSH-SEM-025
  Cenário: Registrar somente validação efetivamente executada
    Dado uma operação sem shapes ou sem evidência necessária à validação
    Quando o gate avalia o candidato
    Então "validationExecuted" deve ser falso e "executedShapes" deve ser vazio
    Mas quando a validação SHACL é executada com resultado explícito
    Então "validationExecuted" deve ser verdadeiro e as shapes executadas devem ser registradas
    E um diff vazio não deve fabricar execução de validação

  @BSH-SEM-026
  Cenário: Vínculo verificável de cada caminho coberto com operação, regra e evidência
    Dado um conjunto de alterações candidatas reconhecidas
    Quando o gate avalia a cobertura do diff
    Então cada caminho coberto deve possuir vínculo com operação, regra e evidência correspondente
    E caminhos não associados à regra não devem ser vinculados automaticamente à operação

  @BSH-SEM-027
  Cenário: Registro separado de cobertura de arquivos, regras e suficiência de evidências
    Dado um candidato avaliado pela governança
    Quando a decisão é emitida
    Então "fileCoverage", "ruleCoverage" e "evidenceSufficiency" devem ser registradas separadamente
    E evidência estrutural e evidência comportamental devem possuir identificação distinta

  @BSH-SEM-028
  Cenário: Avaliação de operações entre domínios com suas dependências
    Dado uma operação governada com dependências entre domínios
    Quando o gate avalia o candidato
    Então as ontologias e shapes dos domínios dependentes devem ser avaliadas em conjunto
    E a conformidade não deve ser presumida pela validação isolada de cada pacote

  @BSH-SEM-029
  Cenário: Preservação de autorizações e estados relacionados em subgrafos SPARQL
    Dado uma seleção de subgrafo candidata por consulta SPARQL
    Quando o recorte é processado para a validação semântica
    Então as autorizações e estados relacionados exigidos pela decisão devem ser preservados
    E um recorte que omita autorizações ou estados exigidos deve resultar em insuficiência de evidência

  @BSH-SEM-030
  Cenário: Decisões distintas para alterações funcionais e alterações de contrato
    Dado um candidato com alterações em arquivos de contrato de domínio
    Quando a decisão de governança é emitida
    Então alterações funcionais e alterações do contrato devem possuir decisões de aprovação distintas
    E uma alteração de contrato não deve ser autorizada por aprovação puramente funcional

  @BSH-SEM-031
  Cenário: Bloqueio de auto-autorização por restrição enfraquecida pelo próprio candidato
    Dado um candidato que enfraquece shapes ou remove políticas de governança em seu próprio diff
    Quando o gate avalia o candidato
    Então a validação deve utilizar a base original e detectar o enfraquecimento de restrições
    E o agente não deve utilizar a restrição enfraquecida para autorizar a alteração

  @BSH-SEM-032
  Cenário: Preservação da identidade da base avaliadora
    Dado uma avaliação de governança do candidato
    Quando a decisão é consolidada
    Então deve registrar a identidade exata da base que efetivamente avaliou o candidato
    E a identidade deve conter commit de origem, digest da ontologia e hash das políticas

  @BSH-SEM-033
  Cenário: Submissão de mudanças em consultas que alterem seleção de evidências à revisão de significado
    Dado um candidato que modifica consultas SPARQL que afetam a seleção de evidências ou subgrafos
    Quando o gate avalia as alterações
    Então deve sinalizar necessidade de revisão de significado
    E a promoção deve permanecer bloqueada até existir aprovação com justificativa semântica de significado

  @BSH-SEM-034
  Cenário: Registro de responsável, justificativa, versão e commit na aprovação de contrato
    Dado uma alteração legítima de contrato de domínio
    Quando a aprovação de contrato é submetida ao broker
    Então o registro deve conter responsável, justificativa, versão e commit do candidato
    E qualquer omissão desses campos deve rejeitar a aprovação

  @BSH-SEM-035
  Cenário: Reconciliação entre inspeção preliminar de diff e decisão de governança
    Dado o mesmo candidato, snapshot, evidências e configuração
    Quando o diff do workspace e a governança de promoção são avaliados
    Então ambas as entradas devem produzir decisão equivalente sem discrepâncias arbitrárias
    E uma inspeção preliminar deve declarar seu escopo e não emitir autorização definitiva

  @BSH-SEM-036 @R3
  Cenário: Separação entre inspeção preliminar, autorização de promoção e narrativa do modelo
    Dado um candidato avaliado pela governança semântica
    Quando o gate emite o resultado
    Então erro, indeterminação, revisão humana, violação e conformidade devem permanecer distinguíveis
    E o gate não deve apresentar validade semântica sem execução demonstrada (R3)
    E a narrativa explicativa produzida pelo modelo deve permanecer separada da autoridade de autorização
  @BSH-SEM-037
  Cenário: Carregamento uniforme e diagnósticos de configuração de governança
    Dado a raiz do projeto e a declaração de domínios em project.json
    Quando o carregador de governança é invocado
    Então o arquivo de configuração de governança deve ser localizado a partir da raiz correta do projeto
    E arquivo inexistente, arquivo inválido e erro de leitura devem produzir diagnósticos e códigos de erro distintos
    E nenhuma exceção de configuração deve ser absorvida silenciosamente sem registro

  @BSH-SEM-038 @R1 @R2
  Cenário: Inventário preciso de alterações Git com suporte a untracked, remoções, renomeações e caracteres especiais
    Dado um workspace Git com alterações candidatas
    Quando o inventário de alterações e o diff preliminar são inspecionados
    Então arquivos novos ainda não rastreados devem ser identificados como alteração com conteúdo atual (R1)
    E arquivos removidos devem ser representados como remoção com conteúdo anterior preservado (R2)
    E renomeações devem preservar os caminhos de origem e destino
    E nomes com espaços, caracteres especiais ou quebras de linha devem ser tratados corretamente por separadores nulos
    E falhas ou erros do Git não devem ser convertidos em diff vazio ou conformidade presumida

  @BSH-SEM-039
  Cenário: Semântica explícita de regras de reconhecimento e ancoragem de globs
    Dado regras de governança declaradas com condições compostas e globs de caminho
    Quando o extrator de operações avalia as alterações do diff
    Então os globs devem ser ancorados estritamente no início e no fim, rejeitando sufixos indevidos
    E comentários, mensagens de log e código morto não devem comprovar execução de operação
    E refatorações equivalentes de espaçamento devem ser reconhecidas corretamente
    E reconhecimento textual puro deve ser identificado como heurístico sem presumir prova estrutural
    E operadores de conjunção e disjunção devem determinar a combinação das condições

  @BSH-SEM-040
  Cenário: Conexão de adaptadores de evidência concretos às entradas de produção
    Dado um candidato submetido à promoção via TUI ou headless
    Quando a decisão de governança extrai fatos concretos do candidato
    Então a extração deve utilizar o candidato identificado e registrar seu commit de origem
    E cada adaptador de evidência deve declarar linguagem, tecnologia, operações atendidas e limitações
    E localizar uma função de autorização não deve equivaler a demonstrar sua execução antes da persistência
    E regras temporais devem exigir evidências da sequência causal de eventos
    E regras dependentes de concorrência devem exigir evidências de teste de concorrência ou protocolo de sincronização
    E a ausência de dados suficientes deve produzir indeterminação e bloquear a promoção

  @BSH-SEM-041
  Cenário: Proveniência completa e persistência da decisão de governança
    Dado uma decisão de governança emitida para um candidato nos chamadores de produção
    Quando a decisão é consolidada e persistida
    Então a implementação deve reutilizar os mecanismos de snapshot e identidade existentes
    E cada evidência deve identificar sua origem, método de obtenção e alcance
    E o registro deve permitir recuperar a base semântica e os fatos exatos utilizados na decisão
    E políticas, versões dos adaptadores e correspondências utilizadas devem ser identificadas
    E consultas SPARQL utilizadas como evidência devem permanecer vinculadas à consulta, fonte e resultados
    E dados externos mutáveis devem possuir versão verificável com política explícita de consistência
    E hashes devem ser apresentados como identificação de conteúdo sem atribuição automática de certificação
    E chamadores de produção devem persistir o registro em .bsh/local/enforcement e atualizar o relatório da sessão

  @BSH-SEM-042
  Cenário: Propagar o resultado real da promoção e derivar códigos de saída
    Dado um candidato submetido à promoção no headless ou na TUI
    Quando o retorno de promoverSessao é examinado
    Então promoção, bloqueio, conflito e falha de validação devem produzir resultados distintos
    E o headless não deve retornar sucesso de promoção quando a origem permanece inalterada
    E a interface deve informar a etapa e o motivo de bloqueio
    E a integração deve ser confirmada comparando o commit integrado com o candidato autorizado
    E promoção negada ou bloqueada deve produzir código de saída diferente de zero no headless
