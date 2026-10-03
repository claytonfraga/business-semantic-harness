# language: pt
# Fontes: src/config; src/cli/authCommand.ts; src/client/openrouter/pkce.ts; src/tui/modals.ts; test/config; test/client/pkce.test.mjs; test/cli/auth-cli.test.mjs; openspec/changes/native-tui-openrouter; test/features/bsh-governance.feature
@bsh @auth
Funcionalidade: Autenticação OpenRouter e preferências

  Como um usuário do BSH
  Eu quero autenticar e controlar minhas preferências
  Para usar sessões configuradas sem expor credenciais

  @BSH-AUTH-001
  Cenário: Carregar variáveis locais
    Dado um arquivo ".env" com comentários, linhas vazias e valores entre aspas simples ou duplas
    Quando a configuração é carregada
    Então as entradas "KEY=VALUE" devem ser interpretadas sem as aspas externas
    E o arquivo deve ser opcional

  @BSH-AUTH-002
  Cenário: Priorizar credenciais
    Dado que há credenciais no ambiente, no ".env" do projeto e no cofre do usuário
    Quando o BSH escolhe a chave da sessão
    Então a variável "OPENROUTER_API_KEY" do processo deve ter prioridade
    E na ausência dela a chave do ".env" deve preceder a chave do cofre global
    E a origem selecionada deve ser identificável

  @BSH-AUTH-003
  Cenário: Priorizar preferências
    Dado que modelo, domínio e confirmação são configurados no ambiente e no ".env"
    Quando o BSH carrega as preferências
    Então as variáveis do processo devem preceder os valores do arquivo
    E "BSH_CONFIRM_PROMPT_VIOLATIONS" deve ser verdadeiro por padrão
    E "BSH_DEFAULT_MODEL" e "BSH_DEFAULT_DOMAIN" devem definir os valores padrão

  @BSH-AUTH-004
  Cenário: Salvar preferências sem apagar outras entradas
    Dado um projeto com preferências existentes
    Quando uma preferência de modelo, domínio ou confirmação muda
    Então o BSH deve atualizar a entrada correspondente no ".env"
    E deve preservar as demais entradas
    E um arquivo novo deve ser criado com permissão 0600

  @BSH-AUTH-005
  Cenário: Autenticar antes de usar o modelo
    Dado que uma chave foi carregada ou informada
    Quando uma sessão é inicializada
    Então a chave deve ser verificada no OpenRouter
    E uma chave inválida deve produzir diagnóstico e impedir o início do agente

  @BSH-AUTH-006
  Cenário: Iniciar login no primeiro acesso
    Dado que nenhuma credencial foi encontrada
    Quando o usuário abre a TUI
    Então deve receber uma interface de autenticação via navegador com alternativa de chave manual
    E deve visualizar a URL de autorização se a abertura automática do navegador falhar

  @BSH-AUTH-007
  Cenário: Gerar desafio PKCE
    Dado que o usuário inicia autenticação web
    Quando o fluxo PKCE é criado
    Então o verificador deve ser aleatório e codificado em base64url
    E o desafio deve corresponder ao SHA-256 do verificador em base64url
    E a autorização deve indicar o método "S256"

  @BSH-AUTH-008
  Cenário: Concluir callback web
    Dado um servidor temporário de callback ligado a "127.0.0.1" em porta disponível
    Quando o navegador entrega um código em "/callback"
    Então o BSH deve trocar o código e o verificador em "/auth/keys"
    E deve retornar a chave ao chamador em memória
    E deve encerrar o servidor temporário
    E a função PKCE isolada não deve escrever credenciais em disco

  @BSH-AUTH-009
  Cenário: Tratar falhas de autenticação web
    Dado um fluxo de autorização em andamento
    Quando ocorre erro do provedor, falha de troca, chave ausente na resposta ou tempo limite
    Então o fluxo deve informar a falha e liberar o servidor temporário
    E um callback sem código deve receber resposta de erro
    E rotas desconhecidas devem receber resposta 404

  @BSH-AUTH-010
  Cenário: Persistir login explícito no cofre
    Dado que o usuário executa "bsh auth login" ou "bsh auth login --manual"
    Quando uma chave válida é obtida
    Então a credencial deve ser salva em "auth.json" no diretório de configuração do usuário
    E o registro deve incluir a data de atualização
    E o diretório novo deve usar permissão 0700 e o arquivo novo permissão 0600
    E uma chave manual vazia deve cancelar a operação

  @BSH-AUTH-011
  Cenário: Resolver cofre por sistema operacional
    Dado que o BSH precisa localizar o cofre do usuário
    Quando resolve o diretório de configuração
    Então deve respeitar "APPDATA" no Windows e "XDG_CONFIG_HOME" quando aplicável
    E deve usar "Library/Application Support/bsh" no macOS ou ".config/bsh" no Linux como alternativas
    E um arquivo ausente ou ilegível deve resultar em configuração vazia

  @BSH-AUTH-012
  Cenário: Consultar estado sem revelar chave
    Dado que o usuário executa "bsh auth status"
    Quando o estado é exibido
    Então deve informar se existe autenticação, sua origem e o caminho do cofre
    E deve mascarar a chave exibindo apenas prefixo e sufixo quando seu tamanho permitir
    E não deve imprimir a chave integral
    E a consulta deve terminar com código 0 mesmo sem autenticação

  @BSH-AUTH-013
  Cenário: Encerrar autenticação persistida
    Dado que o usuário executa "bsh auth logout"
    Quando o comando termina
    Então a credencial do cofre deve ser removida se existir
    E a operação deve ser idempotente
    E credenciais de ambiente ou do projeto devem continuar sendo consideradas pelo carregamento

  @BSH-AUTH-014 @specified @gap
  Cenário: Preservar intenção histórica de sessão efêmera
    Dado que a especificação histórica define autenticação de sessão sem persistência
    Quando esse fluxo efêmero é utilizado
    Então a chave deve existir somente em memória durante a sessão
    E nenhum ".env" ou cofre deve ser escrito por esse fluxo
    E essa exigência deve permanecer distinguível do comando de login persistente

  @BSH-AUTH-015 @specified @historical @gap
  Cenário: Preservar intenção histórica de chave manual local
    Dado que a especificação nativa original prevê chave manual salva no projeto
    Quando esse fluxo de configuração local é adotado
    Então a chave deve ser salva com acesso restrito
    E ".env" e ".env.*" devem ser protegidos por regras de exclusão Git
    E o fluxo deve ser distinguível do login atual no cofre global
