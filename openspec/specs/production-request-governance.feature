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
