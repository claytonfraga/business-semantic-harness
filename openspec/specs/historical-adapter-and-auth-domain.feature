# language: pt
# Fontes: guia-bsh-harness-autenticacao.md; AGENTS.md; src/cli.ts; src/git/finalize.ts
@bsh @legacy
Funcionalidade: Contratos históricos de adaptador e exemplo de domínio de autenticação

  Como um usuário dos exemplos históricos de harness
  Eu quero identificar os contratos descritos no guia original
  Para distinguir funcionalidades legadas e exemplos de domínio da CLI nativa atual

  @BSH-LEGACY-001 @historical @gap @adapter_codex
  Cenário: Iniciar adaptador Codex governado
    Dado um projeto Git com ontologia validada e Codex instalado e autenticado
    Quando o usuário executa "bsh codex" ou "bsh codex --project <caminho>"
    Então o contrato histórico prevê abertura da TUI real do Codex por "codex --remote"
    E prevê um "codex app-server" controlado pelo BSH
    E esse contrato não deve ser confundido com a CLI nativa OpenRouter atual

  @BSH-LEGACY-002 @historical @gap @adapter_codex
  Cenário: Preservar configuração global do Codex
    Dado o adaptador histórico em execução
    Quando prepara sua configuração
    Então deve usar um "CODEX_HOME" privado
    E a instalação e configuração globais do Codex devem permanecer intactas

  @BSH-LEGACY-003 @historical @gap @adapter_codex
  Cenário: Configurar sandbox do adaptador
    Dado uma sessão histórica Codex em worktree isolada
    Quando o sandbox é preparado
    Então deve usar "workspace-write" com raiz gravável na worktree por padrão
    E a opção histórica "BSH_CODEX_SANDBOX=danger-full-access" deve ser distinguida do padrão

  @BSH-LEGACY-004 @historical @adapter_codex
  Cenário: Injetar governança no adaptador
    Dado uma sessão histórica de agente externo
    Quando o agente recebe suas instruções
    Então deve receber contexto de governança e servidor MCP local
    E deve consultar a ontologia antes de modificar código
    E deve relatar conflitos por "bsh_report_conflict"

  @BSH-LEGACY-005 @historical
  Cenário: Decidir exceção sem contornar enforcement
    Dado alertas de conflito durante uma sessão
    Quando o usuário decide sobre uma exceção ao final
    Então a recusa deve descartar o candidato sem alterar a origem
    E uma aprovação humana não deve substituir uma decisão independente de promoção válida
    E o fluxo consultivo histórico deve ser distinguido do enforcement atual

  @BSH-LEGACY-006 @example
  Cenário: Validar login no exemplo de autenticação
    Dado fatos do domínio de exemplo "autenticacao" pertencente ao seu próprio projeto
    Quando "LoginShape" é executada
    Então "estadoConta" deve existir e ser "Ativa" ou "Pendente"
    E deve existir "temCredencial"
    E uma conta "Bloqueada" não deve autenticar

  @BSH-LEGACY-007 @example
  Cenário: Validar ativação de MFA no exemplo
    Dado fatos de "AtivacaoDeMfa" do domínio de exemplo
    Quando "MfaShape" é executada
    Então "mfaAtivo" deve existir e possuir valor verdadeiro

  @BSH-LEGACY-008 @example
  Cenário: Validar sessão no exemplo
    Dado fatos de "Sessao" do domínio de exemplo
    Quando "SessaoShape" é executada
    Então "expiraEm" deve existir
    E o valor de "estadoSessao", quando presente, deve pertencer a "SessaoAtiva" ou "SessaoExpirada"

  @BSH-LEGACY-009 @example
  Cenário: Validar bloqueio de conta no exemplo
    Dado fatos de "BloqueioDeConta" do domínio de exemplo
    Quando "BloqueioShape" e a política aplicável são avaliadas
    Então o estado informado deve ser "Ativa" ou "Pendente"
    E deve existir "motivoBloqueio"
    E a adequação do motivo e impacto deve exigir revisão humana

  @BSH-LEGACY-010 @example
  Cenário: Validar redefinição de senha no exemplo
    Dado fatos de "RedefinicaoDeSenha" do domínio de exemplo
    Quando "RedefinicaoShape" e a política aplicável são avaliadas
    Então deve existir "verificacaoDeIdentidade"
    E a adequação da verificação ao contexto deve exigir revisão humana

  @BSH-LEGACY-011 @example
  Cenário: Preservar propriedade de ontologia de exemplo
    Dado que o guia apresenta um domínio de autenticação como exemplo
    Quando seus requisitos são documentados
    Então devem permanecer identificados como exemplo de domínio
    E o exemplo não deve ser transformado em ontologia global do BSH nem copiado para outro projeto
