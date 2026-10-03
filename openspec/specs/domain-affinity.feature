# language: pt
# Fontes: src/governance/domainAffinity.ts; src/tui/session.ts; src/tui/render.ts; test/governance/domainAffinity.test.mjs; openspec/changes/domain-concept-affinity-check; test/features/journeys/jornada-04-desalinhamento-afinidade.feature
@bsh @aff
Funcionalidade: Afinidade semântica entre domínio e código

  Como um usuário de governança
  Eu quero verificar a relação entre a ontologia e meu projeto
  Para identificar domínio incompatível antes da execução

  @BSH-AFF-001
  Cenário: Extrair vocabulário ontológico
    Dado um domínio com JSON-LD e shapes Turtle
    Quando os conceitos são extraídos
    Então nomes e rótulos dos conceitos, classes alvo, nomes de shapes e caminhos de propriedades devem compor o vocabulário

  @BSH-AFF-002
  Cenário: Inspecionar vocabulário do código
    Dado um projeto com arquivos de código
    Quando o BSH calcula afinidade
    Então deve extrair identificadores e nomes de arquivos relevantes com limites de profundidade e volume
    E deve ignorar metadados BSH, Git, dependências e diretórios derivados
    E deve considerar aliases de conceitos de ativos em português e inglês

  @BSH-AFF-003
  Cenário: Apresentar resultado calculado
    Dado conceitos ontológicos e vocabulário de projeto
    Quando a correspondência é calculada
    Então a resposta deve conter status, pontuação, termos encontrados e termos ausentes
    E a pontuação deve corresponder à proporção de conceitos encontrados
    E dados insuficientes devem produzir "INSUFFICIENT_DATA"

  @BSH-AFF-004
  Cenário: Classificar alinhamento no algoritmo atual
    Dado um projeto com dados suficientes
    Quando a pontuação é pelo menos 0,15 ou há pelo menos 5 correspondências com pontuação pelo menos 0,05
    Então o resultado deve ser "ALIGNED"
    E nos demais casos deve ser "MISMATCH"

  @BSH-AFF-005 @historical @gap
  Cenário: Aplicar limiar de alinhamento da especificação anterior
    Dado um projeto com pelo menos 2 conceitos correspondentes à ontologia
    Quando a classificação segue o contrato histórico de afinidade
    Então o resultado deve ser "ALIGNED" mesmo com pontuação abaixo de 0,15
    E esse resultado histórico deve permanecer distinguível da classificação atual

  @BSH-AFF-006
  Cenário: Alertar antes do primeiro turno com explicação contextual
    Dado um domínio ativo com baixa afinidade
    Quando a TUI inicia ou o usuário troca o domínio
    Então deve verificar afinidade antes da execução seguinte
    E deve exibir "DOMAIN MISMATCH" no cabeçalho e um alerta destacado no feed
    E deve apresentar o diagnóstico semântico comparando o vocabulário detectado com o escopo do domínio ativo
    E deve orientar o uso de "/domain" ou "/ungoverned"
    E o usuário deve poder prosseguir conscientemente

  @BSH-AFF-007
  Cenário: Recalcular por solicitação
    Dado um domínio selecionado
    Quando o usuário executa "/affinity" ou "/alignment"
    Então deve receber pontuação, classificação e conceitos encontrados
    E sem domínio deve receber um diagnóstico em vez de um resultado inventado
