# language: pt
# Fontes: package.json; scripts/prepare-bin.mjs; .github/workflows/ci.yml; .github/workflows/release.yml; AGENTS.md; README.md; openspec/config.yaml; openspec/changes/npm-distribution-and-npx-instructions; openspec/changes/repository-sanitization-and-journey-separation
@bsh @dist
Funcionalidade: Distribuição e regras de engenharia

  Como um mantenedor do BSH
  Eu quero distribuir um produto verificável e documentado
  Para oferecer instalação e execução consistentes

  @BSH-DIST-001
  Cenário: Disponibilizar aliases executáveis
    Dado o pacote npm distribuído
    Quando é instalado globalmente ou executado por npx
    Então "bsh" e "business-semantic-harness" devem apontar para a CLI compilada
    E o executável deve iniciar corretamente mesmo por link simbólico fora do repositório do pacote

  @BSH-DIST-002
  Cenário: Empacotar conteúdo de distribuição
    Dado o processo de build e empacotamento
    Quando o pacote é produzido
    Então deve conter código compilado, README e licença Apache-2.0
    E a CLI compilada deve possuir permissão executável
    E o ambiente deve atender ao requisito Node.js 22 ou superior
    E a distribuição deve incluir a dependência local Bun "1.4.2" para executar a TUI com OpenTUI "0.5.14"
    E comandos não interativos devem executar em Node 22 sem carregar OpenTUI
    E os artefatos nativos disponíveis devem ser verificados na instalação empacotada

  @BSH-DIST-003
  Cenário: Documentar início rápido
    Dado a documentação pública
    Quando um usuário procura instalação e configuração
    Então deve encontrar execução por npx, instalação global e build local
    E deve encontrar opções de projeto, modelo, domínio e autenticação
    E deve encontrar estrutura de governança e exemplos MCP

  @BSH-DIST-004
  Cenário: Validar antes de qualquer push
    Dado mudanças prontas para envio ao GitHub
    Quando o mantenedor prepara o push
    Então deve executar localmente "npm run quality", "npm test" e "npm run test:e2e"
    E somente todos os comandos aprovados devem permitir o push e o acionamento do CI/CD

  @BSH-DIST-005
  Cenário: Executar CI de qualidade e testes
    Dado um push na branch principal, pull request ou disparo manual autorizado
    Quando o workflow CI executa
    Então deve instalar dependências de forma reproduzível com "npm ci"
    E deve executar testes e a suíte E2E no ambiente Node.js configurado
    E após aprovação dos checks deve preservar o pacote instalável e seu checksum SHA-256 como artefatos do pull request
    E essa geração de artefatos não deve publicar versão no npm nem criar release sem evento autorizado

  @BSH-DIST-006
  Cenário: Gerar release verificável
    Dado uma tag de versão ou execução manual autorizada de release
    Quando o workflow de distribuição executa
    Então deve validar testes e gerar o tarball instalável
    E deve produzir checksums SHA-256 e anexá-los à release
    E publicação npm deve depender da credencial configurada
    E credencial ausente deve ser diagnosticada como publicação npm não concluída, sem sucesso silencioso
    E o pacote deve incluir identidade verificável do commit de origem e checksum SHA-256
    E a publicação deve usar versão inédita e tag que corresponda à versão do pacote integrado
    E versões beta devem informar explicitamente o canal npm beta e a documentação deve selecionar esse canal ou uma versão exata

  @BSH-DIST-007
  Cenário: Manter versão consistente
    Dado uma nova versão distribuída
    Quando seus metadados são apresentados
    Então pacote, CLI e componentes MCP devem informar versões compatíveis com a distribuição
    E números antigos fixos não devem representar a versão atual

  @BSH-DIST-008
  Cenário: Derivar testes do OpenSpec após implementação
    Dado um requisito consolidado no OpenSpec
    Quando um novo teste automatizado é escrito
    Então deve derivar desse requisito após a implementação
    E seu nome deve seguir "Given/When/Then"
    E a criação de testes não deve seguir TDD neste projeto

  @BSH-DIST-009
  Cenário: Nomear testes por adaptador
    Dado um teste específico dos adaptadores Agy ou Codex
    Quando o teste e seu arquivo E2E são nomeados
    Então devem usar prefixos "agy:" ou "codex:" e "agy-" ou "codex-" conforme o artefato
    E testes de fumaça devem incluir "smoke" no prefixo

  @BSH-DIST-010
  Cenário: Respeitar idioma dos artefatos
    Dado código, menus, TUI, commits, documentação e testes automatizados
    Quando esses artefatos são criados ou atualizados
    Então devem ser escritos em inglês
    E somente arquivos ".feature" devem usar português com "# language: pt"

  @BSH-DIST-011
  Cenário: Organizar especificações e evidências
    Dado requisitos e jornadas atuais
    Quando são preservados no repositório
    Então os requisitos consolidados devem residir em "openspec/specs"
    E os planos de jornadas devem residir em "test/features/journeys"
    E capturas e vídeos devem residir em "evaluation"
    E diretórios e fixtures obsoletos não devem ser tratados como requisitos atuais do produto

  @BSH-DIST-012
  Cenário: Respeitar execução de terminal e interfaces Java
    Dado uma atividade de desenvolvimento ou validação neste projeto
    Quando comandos de terminal ou interfaces Java são produzidos
    Então os comandos devem utilizar "/usr/bin/rtk"
    E interfaces Java devem declarar contratos sem métodos "default"
    E "rtk serve" não deve ser utilizado

  @BSH-DIST-013 @petreo @regra-de-ouro
  Cenário: Desacoplamento absoluto do produto BSH de qualquer ontologia e independência de domínio
    Dado o pacote npm, a CLI e os artefatos de distribuição do BSH
    Quando o produto é construído, testado ou distribuído
    Então o código do BSH não deve possuir acoplamento rígido a nenhuma ontologia de domínio específica
    E o pacote distribuído não deve incluir ontologias de negócio de projetos em seu código ou distribuição
    E o BSH deve operar estritamente como um harness agnóstico capaz de carregar qualquer ontologia válida presente no projeto
    E as ontologias de domínio pertencem com exclusividade ao projeto respectivo em "<projeto>/.bsh/domains/<dominio>/"
