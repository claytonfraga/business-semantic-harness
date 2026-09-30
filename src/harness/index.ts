/**
 * Núcleo compartilhado do Business Semantic Harness.
 *
 * Ciclo de vida de worktree, reconciliacao/promocao Git, enforcement semantico independente,
 * gates, auditoria/alertas e medicao de tokens.
 */
export {
  alteracoesNaWorktree, branchAtual, commitAtual, criarSessaoWorktree, estaLimpo, git,
  listarWorktrees, removerSessaoWorktree, resolverRepositorio, type SessaoWorktree,
} from '../git/worktree.js';
export { integrar, reconciliar, type ResultadoPromocao, type StatusPromocao, type ValidadorGates } from '../git/promotion.js';
export { finalizeSession, type FinalizeOptions } from '../git/finalize.js';
export { gravarSessao, listarSessoes, type RegistroSessao } from '../git/sessionState.js';
export { writeAlerts, readConflictAlerts, countLines, type ConflictAlert } from '../git/alerts.js';
export { formatUsageReport, type TokenTotals } from '../git/usage.js';
export { avaliarOperacoes } from '../enforcement/motorEnforcement.js';
export { validarOperacao } from '../enforcement/validadorSemantico.js';
export { aplicarRegras, lerDiff } from '../enforcement/extratorOperacoes.js';
export { carregarRegrasGovernanca } from '../enforcement/governanca.js';
export { evaluateGovernance, type CandidateFactsExtractor, type GovernanceDecision,
  type SemanticStatus, type PromotionDecision } from '../enforcement/governanceDecision.js';
export type { EstadoValidacao, OperacaoSemantica, ResultadoEnforcement } from '../enforcement/operacaoSemantica.js';
