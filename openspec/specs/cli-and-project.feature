# language: pt
# Fontes: src/cli.ts; src/project; test/cli.test.mjs; test/cli/headless.test.mjs; test/project; README.md
@bsh @cli
Funcionalidade: Comandos e configuração de projetos BSH

  Como um desenvolvedor
  Eu quero selecionar um projeto e configurar seus domínios pela CLI
  Para iniciar sessões com configuração explícita e diagnósticos verificáveis

  @BSH-CLI-001
  Cenário: Consultar ajuda e versão
    Dado que o pacote BSH está instalado
    Quando o usuário executa "bsh --help" ou "bsh --version"
    Então a ajuda deve descrever os comandos e opções disponíveis
    E a versão deve corresponder à versão distribuída do pacote
    E o processo deve terminar com código 0

  @BSH-CLI-002
  Cenário: Selecionar o projeto alvo
    Dado que o usuário está fora do projeto alvo
    Quando executa "bsh --project <caminho> init"
    Então o caminho deve ser resolvido a partir do diretório atual
    E o manifesto deve ser criado somente no projeto selecionado

  @BSH-CLI-003
  Cenário: Iniciar a interface padrão
    Dado que as condições de autenticação e sessão são satisfeitas
    Quando o usuário executa "bsh" ou "bsh tui"
    Então a interface interativa deve iniciar no projeto selecionado

  @BSH-CLI-004
  Cenário: Rejeitar opções sem argumento
    Dado que uma opção exige um valor
    Quando o usuário fornece "--project", "--api-key", "--model", "--domain", "--prompt" ou "--prompt-file" sem valor
    Então a CLI deve explicar qual argumento está ausente
    E deve terminar com código 2

  @BSH-CLI-005
  Cenário: Rejeitar comando desconhecido
    Dado que o comando informado não pertence à CLI
    Quando o usuário executa esse comando
    Então deve receber orientação para consultar "bsh --help"
    E o processo deve terminar com código 2

  @BSH-CLI-006
  Cenário: Aplicar seleção explícita de modelo e domínio
    Dado que existem valores padrão configurados
    Quando o usuário informa "--model" ou "-m" e "--domain" ou "-d"
    Então a seleção explícita deve prevalecer sobre os valores padrão da sessão

  @BSH-CLI-007
  Cenário: Inicializar manifesto sem sobrescrever configuração
    Dado um projeto sem manifesto BSH
    Quando o usuário executa "bsh init"
    Então deve existir ".bsh/project.json" com "schemaVersion" igual a 1
    E deve conter um identificador de projeto e uma lista inicial vazia de domínios
    Quando o usuário repete a inicialização
    Então o manifesto existente deve permanecer byte a byte intacto

  @BSH-CLI-008
  Cenário: Adicionar domínio local
    Dado um manifesto BSH válido
    Quando o usuário executa "bsh domain add assets"
    Então devem existir ".bsh/domains/assets/ontology.jsonld" e "shapes.ttl"
    E o manifesto deve declarar os caminhos relativos, a versão "1.0.0" e a IRI base do domínio
    E o esqueleto deve exigir conceitos e regras antes de ser considerado pronto

  @BSH-CLI-009
  Cenário: Preservar domínio existente
    Dado um domínio já cadastrado ou um diretório de domínio existente
    Quando o usuário tenta adicionar o mesmo domínio
    Então a operação deve falhar com diagnóstico explícito
    E os arquivos existentes devem permanecer intactos

  @BSH-CLI-010
  Cenário: Validar estrutura do manifesto
    Dado um manifesto fornecido pelo projeto
    Quando o BSH carrega sua configuração
    Então deve exigir objeto JSON, "schemaVersion" 1, "projectId" não vazio e uma lista "domains"
    E cada domínio deve possuir "id", "version", "baseIri", "ontology" e "shapes" não vazios
    E identificadores devem corresponder a "^[a-z][a-z0-9-]*$"
    E identificadores duplicados, IRI base inválida e versões de formato desconhecidas devem ser rejeitados

  @BSH-CLI-011
  Cenário: Diagnosticar manifesto ausente ou ilegível
    Dado que o manifesto não existe ou não contém JSON válido
    Quando uma operação exige o manifesto
    Então o BSH deve indicar o arquivo e a causa da falha
    E não deve tratar o projeto como pronto para governança

  @BSH-CLI-012
  Cenário: Restringir arquivos ao projeto real
    Dado um caminho absoluto, uma travessia por ".." ou um link simbólico para fora do projeto
    Quando uma operação de configuração ou ontologia resolve esse caminho
    Então o acesso deve ser rejeitado após a resolução canônica
    E somente arquivos internos ao projeto devem ser aceitos

  @BSH-CLI-013
  Cenário: Manter ontologias no projeto proprietário
    Dado um domínio pertencente a um projeto
    Quando o domínio é configurado ou uma cópia limpa do projeto é selecionada
    Então a ontologia própria deve residir em "<projeto>/.bsh/domains/<dominio>/"
    E o pacote BSH, outros projetos e diretórios globais não devem receber cópias dessa ontologia
    E "test/fixtures" deve conter somente ontologias sintéticas de teste do BSH
