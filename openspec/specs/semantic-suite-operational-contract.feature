# language: pt
# Fontes: openspec/specs/semantic-enforcement-and-promotion-gate.feature; test/e2e-live/semantic-enforcement.semantic.mjs; scripts/run-e2e-pipeline.mjs; .github/workflows/ci.yml; .github/workflows/release.yml
@bsh @sem @qa
Funcionalidade: Reconciliação operacional e execução contínua da suíte semântica
  Como um arquiteto de qualidade
  Eu quero verificar decisões com evidências observadas pelos mecanismos de produção
  Para impedir que expectativas antigas ou testes omitidos autorizem uma promoção

  @BSH-SEM-QA-001
  Cenário: Integrar candidato comprovadamente conforme com gates reais
    Dado um projeto sintético com ontologia própria validada e sem política de revisão humana
    E uma alteração reconhecida com fatos independentes ligados ao commit candidato
    Quando a finalização executa o extrator de produção, SHACL, gates técnicos e integração Git
    Então somente o hash do candidato autorizado deve ser integrado
    E o registro deve comprovar cobertura, validação executada, gates aprovados e alteração da origem

  @BSH-SEM-QA-002
  Cenário: Distinguir bloqueios sem substituir a autoridade semântica
    Dado candidatos violadores, indeterminados, não reconhecidos ou sem extrator
    Quando a finalização avalia cada candidato separadamente
    Então a origem deve permanecer intacta
    E deve distinguir violação, ausência de fatos, ausência de reconhecimento e ausência de extração
    E confirmação ordinária não deve substituir revisão humana vinculada ao candidato
    E testes técnicos conformes não devem autorizar uma violação SHACL

  @BSH-SEM-QA-003
  Cenário: Executar testes técnicos filhos mesmo dentro de uma suíte Node
    Dado uma suíte Node que iniciou uma sessão com candidato semanticamente conforme
    E o projeto candidato possui um teste técnico que falha
    Quando o gate técnico inicia o processo de testes do projeto
    Então o contexto interno do executor de testes pai não deve suprimir os testes filhos
    E a falha técnica real deve impedir integração com resultado "falha-validacao"

  @BSH-SEM-QA-004
  Cenário: Executar a suíte reconciliada no pipeline e no CI
    Dado os workflows de verificação e distribuição
    Quando os pipelines executam qualidade, testes e E2E
    Então a suíte de integração semântica deve ser executada uma única vez pelo pipeline E2E
    E falha semântica deve interromper o pipeline antes da publicação
    E nenhum vídeo ou captura de lotes anteriores deve ser apagado pela verificação

  @BSH-SEM-QA-005
  Cenário: Identificar o alcance da evidência de teste
    Dado uma execução da suíte semântica
    Quando seus resultados são relatados
    Então integração de módulos deve ser distinguida de sessão funcional TUI ou headless empacotada
    E fixtures sintéticas, transporte de modelo simulado e quaisquer mocks devem ser identificados
    E identificadores de regressão sem requisito recuperável não devem receber cobertura inventada
