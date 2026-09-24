/**
 * Núcleo compartilhado do Business Semantic Harness.
 *
 * Ponto de entrada único para os adaptadores de agente (Codex, Agy): ciclo de vida de
 * worktree, reconciliacao/promocao Git, enforcement semantico independente, gates,
 * auditoria/alertas e medicao de tokens. Os adaptadores nao devem importar uns aos
 * outros; dependem apenas deste nucleo.
 */
export {
  alteracoesNaWorktree, branchAtual, commitAtual, criarSessaoWorktree, estaLimpo, git,
  listarWorktrees, removerSessaoWorktree, resolverRepositorio, type SessaoWorktree,
} from '../agents/codex/worktree.js';
export { integrar, reconciliar, type ResultadoPromocao, type StatusPromocao, type ValidadorGates } from '../agents/codex/promotion.js';
export { finalizeSession, type FinalizeOptions } from '../agents/codex/finalize.js';
export { gravarSessao, listarSessoes, type RegistroSessao } from '../agents/codex/sessionState.js';
export { writeAlerts, readConflictAlerts, countLines, type ConflictAlert } from '../agents/codex/alerts.js';
export { formatUsageReport, type TokenTotals } from '../agents/codex/usage.js';
export { avaliarOperacoes } from '../enforcement/motorEnforcement.js';
export { validarOperacao } from '../enforcement/validadorSemantico.js';
export { aplicarRegras, lerDiff } from '../enforcement/extratorOperacoes.js';
export { carregarRegrasGovernanca } from '../enforcement/governanca.js';
export type { EstadoValidacao, OperacaoSemantica, ResultadoEnforcement } from '../enforcement/operacaoSemantica.js';
