# language: pt
# Fontes: solicitação de correção do fluxo de produção; README; src/agent/headless.ts; src/tui/session.ts
@bsh @production_governance
Funcionalidade: Preparação ontológica de cada solicitação nas entradas de produção
  Como usuário do BSH
  Eu quero que o contrato soberano do projeto governe o envio ao modelo
  Para que contexto e autorização antecedam ferramentas, validação e promoção independentes

  @BSH-PREP-001
  Cenário: Recuperar o contrato real antes do primeiro envio
    Dado uma solicitação e domínio ativo declarados no projeto
    Quando a TUI ou headless prepara a solicitação
    Então deve carregar e validar manifesto, ontologia, shapes e configurações declaradas
    E consultar conceitos, operações, políticas e correspondências com origem, versão e hash
    E preservar dependências e restrições aninhadas recuperando os documentos necessários integralmente quando seleção parcial for insegura
    E a seleção só deve ser suficiente com correspondências estabelecidas, alvos de classe explícitos e referências estruturais resolvidas no fechamento declarado
    E ausência de raízes pertinentes, alvos não selecionáveis, consultas SHACL-SPARQL ou dependências de hierarquia devem acionar recuperação integral da ontologia e shapes de todo o fechamento declarado
    E referências estruturais ausentes ou listas RDF incompletas devem interromper com diagnóstico antes do transporte
    E recuperação integral deve manter origem e hashes e passar pelo orçamento completo sem truncamento
    E nenhum envio contendo a solicitação deve ocorrer antes da preparação concluída

  @BSH-PREP-002
  Cenário: Separar instrução do usuário e contexto recuperado
    Dado uma preparação autorizada
    Quando o payload é enviado ao modelo selecionado
    Então o prompt original deve permanecer recuperável sem reescrita silenciosa
    E o contexto ontológico e suas limitações devem ocupar uma mensagem estruturada separada
    E diretivas e solicitação efetiva de uma skill devem ser verificadas antes do envio
    E o modelo escolhido pelo usuário deve permanecer o destinatário

  @BSH-PREP-003
  Cenário: Decidir antes do envio sem afirmar conformidade sem prova
    Dado as políticas e correspondências do contrato real
    Quando a pertinência da solicitação é avaliada
    Então a decisão deve distinguir ALLOW, BLOCK, HUMAN_REVIEW, INSUFFICIENT_INFORMATION e CONFIGURATION_ERROR
    E políticas devem ser avaliadas mesmo sem shapes aplicáveis
    E ausência de alerta heurístico ou de resultado de consulta não deve declarar conformidade
    E linguagem natural não deve ser validada por SHACL como se fosse um grafo de fatos
    E evidências de intenção e limitações de representação devem permanecer identificadas

  @BSH-PREP-004
  Cenário: Diferenciar execução proibida de explicação e testes
    Dado uma regra de proibição declarada pelo contrato
    Quando a solicitação pede executar a operação proibida
    Então deve aplicar a proibição ou revisão permitida pelo contrato antes do modelo
    Mas quando solicita explicar a regra, inspecioná-la ou implementar teste de bloqueio
    Então deve avaliar esse propósito separadamente e incluir a regra no contexto
    E diretivas efetivas conflitantes não devem ser ocultadas por um prefixo explicativo

  @BSH-PREP-005
  Cenário: Confirmar revisão na TUI sem autorizar promoção
    Dado uma decisão HUMAN_REVIEW permitida pela política
    Quando a TUI apresenta decisão, motivos e referências
    Então deve aguardar confirmação vinculada ao prompt e snapshot
    E cancelamento deve causar zero chamadas contendo a solicitação
    E aprovação de envio não deve aprovar ferramentas ou promoção automaticamente
    E preferência de confirmação não pode contornar proibição ou revisão obrigatória

  @BSH-PREP-006
  Cenário: Interromper revisão pendente no headless
    Dado uma decisão de revisão sem aprovação válida vinculada à solicitação e contrato
    Quando headless processa a solicitação
    Então deve encerrar com diagnóstico e código de saída não zero sem enviá-la ao modelo
    E alerta ou opção de execução direta não deve conceder autorização

  @BSH-PREP-007
  Cenário: Falhar com domínio explícito indisponível
    Dado um domínio explicitamente selecionado
    Quando domínio, configuração ou dependência não pode ser carregado
    Então deve distinguir DOMAIN_NOT_FOUND, INVALID_CONFIGURATION, READ_ERROR e DEPENDENCY_UNAVAILABLE
    E nenhuma solicitação deve ser enviada em modo silenciosamente não governado
    E execução sem governança deve exigir seleção explícita e estado consistente

  @BSH-PREP-008
  Cenário: Repreparar após troca de domínio ou alteração de contrato
    Dado solicitações sucessivas em uma sessão
    Quando domínio, políticas, correspondências ou contrato muda
    Então a preparação anterior deve ser invalidada
    E cada nova solicitação deve carregar a base atual
    E se a base mudar entre preparação e envio a chamada deve ser interrompida
    E o snapshot de envio deve abranger configurações de enforcement e skill efetivamente utilizadas

  @BSH-PREP-009
  Cenário: Despachar ferramentas governadas pelo broker do host
    Dado solicitação autorizada para envio
    Quando o modelo solicita ferramenta nativa ou MCP
    Então ApprovalBroker da entrada de produção deve autorizar antes dos efeitos
    E leitura, mutação, argumentos, confinamento, efeitos externos e auditoria devem preservar seus controles
    E uma autorização de ferramenta válida deve ser consumida uma vez sem perguntas redundantes
    E ferramentas MCP desconhecidas quanto a efeitos devem exigir autorização conservadora

  @BSH-PREP-010
  Cenário: Preservar validação posterior do candidato
    Dado candidatos conformes e violadores produzidos após solicitação autorizada
    Quando extração, validação e promoção são executadas
    Então seus gates independentes devem continuar verificando evidências e commit
    E aprovação prévia do prompt não deve substituir provas do candidato

  @BSH-PREP-011
  Cenário: Verificar os payloads nas entradas reais com transporte controlado
    Dado a TUI e headless de produção com transporte de modelo controlado
    Quando solicitações autorizadas, bloqueadas, canceladas e com revisão pendente são processadas
    Então testes devem registrar payload e ordem real de preparação e despacho
    E regras modificadas devem alterar contexto ou decisão
    E chamadas pagas não devem ser necessárias
    E mocks de preparação isolada ou mensagens de interface não devem substituir evidência do fluxo real

  @BSH-PREP-012
  Cenário: Avaliar todas as instruções e finalidades combinadas
    Dado uma proibição de executar uma operação declarada no contrato
    Quando solicitação efetiva ou diretivas de skills combinam explicação, inspeção ou testes com execução
    Então a finalidade informativa não deve isentar a execução presente em outra instrução
    E separadores, listas e conjunções em português ou inglês devem receber tratamento consistente
    E conectivos não devem depender exclusivamente de uma lista fechada de verbos para separar instruções potencialmente executáveis
    E Explain Publish and develop Publish e Explique Publish e desenvolva Publish devem receber as mesmas verificações que instruções separadas por ponto
    E desenvolver, construir e refatorar combinados com consultas ou testes devem ser avaliados separadamente
    E interpretação incerta deve aplicar a política de incerteza ou revisão sem autorização implícita
    Mas explicar a regra ou escrever exclusivamente testes de bloqueio deve continuar permitido

  @BSH-PREP-013
  Cenário: Resolver operações pela identidade soberana do domínio
    Dado correspondências declaradas por caminho, aliases ou nome de operação
    Quando uma operação usa nome local ou IRI completo
    Então deve resolver a mesma identidade usando baseIri do domínio de origem
    E políticas devem produzir decisões equivalentes independentemente da existência de shapes
    E domínios dependentes com nomes locais iguais devem permanecer distintos
    E correspondência inexistente ou ambígua deve impedir autorização implícita

  @BSH-PREP-014
  Cenário: Separar conceitos mencionados de operações estabelecidas
    Dado conceitos, operações e aliases do contrato soberano
    Quando uma solicitação pede execução
    Então entidades, estados e propriedades mencionadas não devem substituir reconhecimento da operação
    E ausência de operação estabelecida deve aplicar a política de incerteza configurada
    E tokens curtos distintivos como TI devem permanecer significativos na correspondência
    E explicações e inspeções autorizadas devem preservar seu comportamento

  @BSH-PREP-015
  Cenário: Verificar o orçamento completo antes de cada envio
    Dado a janela do modelo escolhido e reserva explícita para resposta
    Quando TUI ou headless prepara uma chamada inicial ou posterior
    Então deve estimar o payload completo incluindo sistema, contrato, skills, histórico e ferramentas
    E contratos e representações equivalentes não devem ser repetidos sem necessidade
    E proveniência, referências e dependências devem permanecer recuperáveis
    E contexto que excede a janela conhecida deve interromper antes da chamada ao provedor com diagnóstico
    E limite desconhecido ou falha de metadados deve interromper por padrão antes do envio com diagnóstico
    E um limite positivo explicitamente informado pelo host pode estabelecer o orçamento sem substituir o modelo
    E nenhuma regra ou dependência deve ser truncada silenciosamente nem o modelo substituído
    E o método de estimativa e suas limitações devem permanecer declarados

  @BSH-PREP-023
  Cenário: Recuperar fechamento das restrições relevantes sem perda de conteúdo
    Dado uma shape pertinente com sh:in contendo APPROVED e dependências aninhadas
    Quando a preparação recupera o contexto para o modelo
    Então deve incluir listas RDF completas, nós anônimos, combinações lógicas e caminhos compostos
    E deve recuperar shapes referenciadas mesmo sem alvo próprio
    E ciclos devem terminar e referências compartilhadas devem aparecer uma vez por grafo recuperado
    E termos devem preservar identidade, tipo, datatype e idioma com origem e hash do documento
    E somente o fechamento necessário deve ser enviado sem repetir toda a ontologia nem truncar regras
    E a validação posterior deve continuar distinguindo APPROVED de REJECTED

  @BSH-PREP-024
  Cenário: Interpretar ação, objeto, negação e complementos informativos
    Dado uma política que proíbe executar Publish
    Quando a solicitação pede Implemente Publish sem testes ou Implement Publish without tests
    Então deve identificar execução e bloquear antes de qualquer chamada ao modelo
    Mas quando pede Inspect Publish in src/service.js ou Explain Publish, including its constraints
    Então deve preservar inspeção ou explicação e permitir consulta dentro do orçamento estabelecido
    E pontos em caminhos e vírgulas em complementos não devem criar instruções de execução
    E explicação ou testes combinados com execução proibida devem continuar bloqueados
    E negação explícita de execução não deve ser confundida com pedido para executá-la
    E ambiguidade de finalidade deve permanecer identificada e receber tratamento conservador

  @BSH-PREP-016
  Cenário: Orientar a solicitação não reconhecida sem chamar o modelo
    Dado que a preparação resulta em INSUFFICIENT_INFORMATION
    Quando a TUI ou o headless apresenta a decisão
    Então deve exibir uma remediação determinística informando que nenhuma operação governada foi reconhecida
    E deve listar os conceitos reconhecidos como apenas menções
    E a remediação não deve acionar o provedor de modelo nem consumir tokens
    E a remediação não deve afirmar conformidade do candidato

  @BSH-PREP-017
  Cenário: Sugerir a operação mais próxima do domínio
    Dado que o domínio declara operações governadas e aliases
    Quando nenhuma operação é reconhecida na solicitação
    Então deve sugerir a operação lexicalmente mais próxima como pergunta, nunca como decisão
    E deve manter disponíveis as demais operações governadas do domínio
    E a sugestão não deve alterar a decisão nem autorizar implicitamente

  @BSH-PREP-018
  Cenário: Listar saídas acionáveis para decisões não autorizadas
    Dado uma decisão diferente de ALLOW
    Quando a remediação é apresentada
    Então deve listar saídas acionáveis, incluindo reformular o pedido, trocar o domínio e operar sem o harness
    E deve confirmar revisão quando a decisão exigir revisão humana
    E deve reutilizar as regras aplicáveis já recuperadas do contrato
    E CONFIGURATION_ERROR deve informar a causa e ações específicas para domínio inexistente, configuração inválida, erro de leitura e dependência indisponível
    E HUMAN_REVIEW deve oferecer aprovação pelo mecanismo autorizado, cancelamento, reformulação e troca de domínio
    E headless sem aprovador deve explicar a interrupção e opções por argumentos CLI sem alterar o código de saída
    E a orientação deve ser determinística e local, sem mudar a decisão nem afirmar conformidade

  @BSH-PREP-019
  Cenário: Distinguir domínio sem operações governadas
    Dado um domínio ativo que não declara nenhuma operação governada
    Quando uma solicitação de execução não é reconhecida
    Então a remediação deve informar que o domínio não declara operações governadas
    E deve sugerir verificar o domínio ativo

  @BSH-PREP-020
  Cenário: Preservar a preparação determinística e compartilhada
    Dado TUI e headless usando a mesma preparação
    Quando a remediação é produzida
    Então a mesma orientação determinística deve estar disponível em ambos
    E nenhuma chamada ao provedor deve ser feita para gerá-la
    E a independência entre envio, ferramentas e promoção deve permanecer intacta

  @BSH-PREP-021
  Cenário: Remediação apenas orienta e não decide
    Dado uma decisão de bloqueio, revisão ou incerteza
    Quando a remediação é exibida
    Então ela não deve substituir o gate nem promover o candidato
    E não deve transformar ausência de alertas em permissão de escrita
    E deve permanecer no idioma da interface
