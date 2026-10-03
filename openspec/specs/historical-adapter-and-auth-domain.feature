# language: pt
# Fontes: guia-bsh-harness-autenticacao.md; AGENTS.md; src/cli.ts; src/git/finalize.ts
@bsh @legacy
Funcionalidade: Contratos históricos de adaptador e exemplo de domínio de autenticação

  Como um usuário dos exemplos históricos de harness
  Eu quero identificar os contratos descritos no guia original
  Para distinguir funcionalidades legadas e exemplos de domínio da CLI nativa atual

  @BSH-LEGACY-001 @historical
  Cenário: Descontinuação de adaptadores externos de terceiros
    Dado a evolução da arquitetura do BSH para um agente autônomo nativo
    Quando o suporte a adaptadores históricos externos é avaliado
    Então o BSH estabelece que a execução é provida pelo agente de codificação nativo integrado
    E adaptadores externos de terceiros são declarados descontinuados e desprovidos de suporte

  @BSH-LEGACY-002 @historical
  Cenário: Preservação de configurações e isolamento no agente nativo
    Dado o agente autônomo nativo em execução
    Quando prepara seu ambiente de execução
    Então deve operar sobre worktrees isolados e variáveis controladas
    E a configuração global do ambiente do usuário deve permanecer intacta

  @BSH-LEGACY-003 @historical
  Cenário: Configurar sandbox seguro no agente nativo
    Dado uma sessão do BSH em worktree isolada
    Quando o sandbox é preparado
    Então deve usar workspace controlado com raiz gravável na worktree por padrão
    E o branch principal e checkout original devem permanecer protegidos

  @BSH-LEGACY-004 @historical
  Cenário: Injetar governança semântica no agente nativo
    Dado uma sessão interativa do agente nativo
    Quando o agente recebe suas instruções
    Então deve receber contexto ontológico e ferramentas MCP de governança
    E deve consultar a ontologia antes de modificar código
    E deve relatar conflitos negociais diretamente ao Semantic Gate

  @BSH-LEGACY-005 @historical
  Cenário: Decidir exceção sem contornar enforcement
    Dado alertas de conflito durante uma sessão
    Quando o usuário decide sobre uma alteração ao final
    Então a recusa deve descartar o candidato sem alterar a origem
    E uma aprovação humana não deve substituir uma decisão independente de promoção válida
    E a salvaguarda ontológica ativa deve ser soberana

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
