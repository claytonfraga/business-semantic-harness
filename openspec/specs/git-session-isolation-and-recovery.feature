# language: pt
# Fontes: src/git; test/git; test/e2e-live/worktree-isolation.e2e.mjs; test/e2e-live/worktree-adversarial.e2e.mjs; README.md
@bsh @git
Funcionalidade: Isolamento Git, integração e recuperação de sessões

  Como um desenvolvedor
  Eu quero trabalhar em sessões isoladas e promover mudanças com segurança
  Para preservar commits e alterações locais do checkout principal

  @BSH-GIT-001
  Cenário: Resolver repositório e congelar base
    Dado um projeto dentro de um repositório Git
    Quando a sessão isolada é criada
    Então deve registrar raiz, branch de origem e commit base
    E o commit base não deve mudar silenciosamente se a origem avançar

  @BSH-GIT-002
  Cenário: Criar worktree e branch exclusivos
    Dado sessões iniciadas simultaneamente ou repositórios de mesmo nome
    Quando o BSH cria suas worktrees
    Então cada sessão deve possuir identificador, caminho e branch "bsh/session/<id>" exclusivos
    E o diretório deve distinguir repositórios pelo caminho canônico
    E "BSH_WORKTREES_DIR" deve permitir configurar o diretório base

  @BSH-GIT-003
  Cenário: Preservar checkout durante edição
    Dado uma sessão isolada
    Quando o agente cria, edita, renomeia ou remove arquivos
    Então somente a worktree deve receber as mudanças antes da promoção
    E conteúdo, branch e alterações locais do checkout principal devem permanecer intactos

  @BSH-GIT-004
  Cenário: Incluir estado local sem destruí-lo
    Dado alterações não commitadas e arquivos não rastreados na origem
    Quando o usuário inicia uma sessão com inclusão de estado local
    Então esses dados devem ser transferidos para a worktree
    E o estado original não deve ser removido por stash, reset, restore ou clean

  @BSH-GIT-005
  Cenário: Excluir registros locais do Git
    Dado que a sessão registra auditoria e estado
    Quando a infraestrutura local é preparada
    Então ".bsh/local/" deve ser excluído pelo mecanismo local do Git
    E esses registros não devem contaminar o diff de implementação

  @BSH-GIT-006
  Cenário: Estabilizar alterações em commit de sessão
    Dado mudanças na worktree
    Quando a reconciliação prepara o candidato
    Então deve criar commit das mudanças quando necessário
    E uma worktree sem mudanças não deve produzir commit vazio

  @BSH-GIT-007
  Cenário: Bloquear origem suja
    Dado um checkout principal com alterações locais
    Quando a promoção é solicitada
    Então a integração deve ser bloqueada sem sobrescrever arquivos
    E as alterações devem permanecer disponíveis na worktree para revisão

  @BSH-GIT-008
  Cenário: Reconciliar avanço da origem
    Dado novos commits na branch de origem desde o início da sessão
    Quando a sessão é reconciliada
    Então o candidato deve incorporar os commits por rebase na worktree
    E deve ser validado no estado reconciliado
    E nenhum commit da origem deve ser perdido

  @BSH-GIT-009
  Cenário: Confinar conflitos à worktree
    Dado alterações conflitantes na origem e na sessão
    Quando a reconciliação falha
    Então o conflito e seus arquivos devem permanecer somente na worktree
    E o checkout principal deve continuar intacto
    E o estado da sessão deve indicar "CONFLICTED"

  @BSH-GIT-010
  Cenário: Executar gates técnicos disponíveis
    Dado um candidato pronto para integração
    Quando os gates técnicos são executados
    Então scripts "quality" e "test" definidos no projeto devem executar na worktree
    E falha técnica deve impedir promoção
    E ausência de package.json ou scripts deve ser informada sem inventar testes executados

  @BSH-GIT-011
  Cenário: Promover mudanças de arquivo com integridade
    Dado um candidato aprovado sem mudanças tardias
    Quando a integração por fast-forward é concluída
    Então criações, edições, exclusões, renomeações e nomes com espaços devem alcançar a origem
    E o commit promovido deve continuar existente após limpeza da worktree

  @BSH-GIT-012
  Cenário: Preservar candidato bloqueado
    Dado que a validação, reconciliação ou integração falha
    Quando a sessão é finalizada
    Então deve registrar estado e motivo da falha
    E deve preservar a worktree para correção quando a política de finalização assim exigir
    E não deve anunciar promoção

  @BSH-GIT-013
  Cenário: Finalizar sessão sem alterações
    Dado uma sessão sem mudanças nem alertas
    Quando a finalização é solicitada
    Então deve informar que nada será promovido
    E deve limpar a worktree e registrar o estado final

  @BSH-GIT-014
  Cenário: Consultar sessões e identificar órfãs
    Dado registros locais e worktrees Git existentes
    Quando o usuário executa "bsh sessions list"
    Então deve listar identificador, estado, branch, caminho e condição de órfã
    E deve incluir worktrees "bsh/session" sem registro correspondente

  @BSH-GIT-015
  Cenário: Limpar sessão explicitamente
    Dado uma sessão registrada ou órfã
    Quando o usuário executa "bsh sessions clean <id>"
    Então deve remover somente a worktree e branch da sessão selecionada
    E deve preservar o checkout principal
    E identificador desconhecido deve receber diagnóstico sem remoção de outras sessões

  @BSH-GIT-016
  Cenário: Registrar resultado de finalização
    Dado uma sessão finalizada
    Quando o relatório local é gravado
    Então deve registrar hashes inicial e final, commits, diff, arquivos e linhas alteradas
    E deve registrar promoção, bloqueio, execução de enforcement e alteração da origem de forma separada

  @BSH-GIT-017
  Cenário: Recuperar conteúdo por backup
    Dado um backup de projeto usado pelo módulo de snapshot
    Quando arquivos são criados, alterados ou removidos
    Então os caminhos alterados devem ser detectados por hash
    E a restauração deve recuperar arquivos anteriores e remover arquivos novos
    E diretórios derivados e registros locais devem ser excluídos da comparação

  @BSH-GIT-018 @gap
  Cenário: Diagnosticar ausência de isolamento
    Dado que Git não está disponível ou o projeto não é um repositório
    Quando o caminho nativo inicia uma sessão
    Então o fallback atual pode operar no diretório selecionado
    E a garantia especificada de isolamento estrito deve ser registrada como não satisfeita nesse caminho
