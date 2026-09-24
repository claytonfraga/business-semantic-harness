import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { appendAudit } from '../../decision/audit.js';
import { actionDigest, evaluateAction, type ProposedAction } from '../../decision/evaluate.js';
import type { OntologySnapshot } from '../../ontology/query.js';
import { validateProject } from '../../ontology/validate.js';
import { carregarRegrasGovernanca } from '../../enforcement/governanca.js';
import { aplicarRegras, lerDiff } from '../../enforcement/extratorOperacoes.js';
import { avaliarOperacoes } from '../../enforcement/motorEnforcement.js';
import type { ResultadoEnforcementLote } from '../../enforcement/operacaoSemantica.js';
import { writeAlerts, type ConflictAlert } from './alerts.js';
import { alteracoesNaWorktree, removerSessaoWorktree, type SessaoWorktree } from './worktree.js';
import { promoverSessao, type StatusPromocao, type ValidadorGates } from './promotion.js';
import { gravarSessao } from './sessionState.js';
import type { FileChange } from './snapshot.js';
import { formatSavingsReport, formatUsageReport, type SavingsReport, type TokenTotals } from './usage.js';

export interface FinalizeOptions {
  sessao: SessaoWorktree;
  domain: string;
  snapshot: OntologySnapshot;
  alerts: ConflictAlert[];
  tokenTotals: TokenTotals | undefined;
  ontologyQueries: number;
  harnessTokens: number;
  savings?: SavingsReport;
  validarGates?: ValidadorGates;
}

export interface ResultadoFinalizacao {
  status: StatusPromocao | 'sem-alteracoes' | 'descartado';
  promovido: boolean;
}

function buildAction(domain: string, change: FileChange): ProposedAction {
  return {
    id: randomUUID(),
    tool: 'codex_native_edit',
    domain,
    arguments: { path: change.path, existedBefore: change.existedBefore },
    mutates: true,
    intercepted: false,
    representation: 'partial',
  };
}

async function auditChange(
  root: string,
  domain: string,
  change: FileChange,
  snapshot: OntologySnapshot,
  decision: 'allow' | 'deny',
  actor: string,
  reason: string,
): Promise<void> {
  const action = buildAction(domain, change);
  const evaluation = await evaluateAction(root, action, snapshot);
  await appendAudit(root, {
    time: new Date().toISOString(),
    actionId: action.id,
    domain,
    actionDigest: actionDigest(action, snapshot.digest),
    snapshotDigest: snapshot.digest,
    rules: evaluation.rules,
    evaluation: evaluation.status,
    confidence: evaluation.confidence,
    decision,
    actor,
    reason,
  });
}

async function confirmException(branchOrigem: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question(`Aprovar excecao e promover as alteracoes da worktree para ${branchOrigem}? [s/N] `)).trim().toLowerCase();
    return answer === 's' || answer === 'sim';
  } finally {
    terminal.close();
  }
}

export async function finalizeSession(options: FinalizeOptions): Promise<ResultadoFinalizacao> {
  const { sessao, domain, snapshot, alerts, tokenTotals, ontologyQueries, harnessTokens, savings, validarGates } = options;
  const root = sessao.repositorioOrigem;
  process.stdout.write(`\n${formatUsageReport(tokenTotals, ontologyQueries, alerts.length, harnessTokens)}\n`);
  if (savings) process.stdout.write(`${formatSavingsReport(savings)}\n`);
  if (alerts.length > 0) {
    const alertsFile = await writeAlerts(root, randomUUID(), alerts);
    process.stdout.write(`\nALERTA: a sessao contrariou ou nao confirmou a ontologia. Registrado em ${alertsFile}.\n`);
    for (const alert of alerts) {
      process.stdout.write(`  - [${alert.domain}] ${alert.reason} | regras: ${alert.conflictingRules.join('; ')}\n`);
    }
  }
  const alteracoes = await alteracoesNaWorktree(sessao);
  process.stdout.write(`BSH: worktree da sessao ${sessao.id} em ${sessao.caminhoWorktree}; branch ${sessao.branchSessao}.\n`);
  if (alteracoes.length === 0 && alerts.length === 0) {
    process.stdout.write('BSH: nenhuma alteracao do Codex na worktree; nada a promover.\n');
    await gravarSessao(root, sessao, 'CLEANED');
    await removerSessaoWorktree(sessao, false);
    return { status: 'sem-alteracoes', promovido: false };
  }
  if (alteracoes.length > 0) {
    process.stdout.write(`BSH: ${alteracoes.length} arquivo(s) alterado(s): ${alteracoes.map((change) => change.path).join(', ')}\n`);
  }

  let enforcement: ResultadoEnforcementLote = { status: 'conforme', bloquear: false, resultados: [] };
  if (process.env.BSH_ENFORCEMENT !== 'off' && alteracoes.length > 0) {
    const regras = await carregarRegrasGovernanca(root);
    const diffs = await lerDiff(sessao.caminhoWorktree, sessao.commitBase);
    const operacoes = aplicarRegras(regras, diffs);
    if (operacoes.length > 0) {
      enforcement = await avaliarOperacoes(root, snapshot, operacoes);
      process.stdout.write(`\nBSH enforcement independente: ${enforcement.resultados.length} operacao(oes) governada(s); status ${enforcement.status}.\n`);
      for (const resultado of enforcement.resultados) {
        process.stdout.write(`  - [${resultado.dominio}] ${resultado.operacao}: status=${resultado.status}${resultado.shape ? ` shape=${resultado.shape}` : ''}${resultado.regra ? ` regra=${resultado.regra}` : ''}\n`);
      }
      const diretorio = join(root, '.bsh', 'local', 'enforcement');
      await mkdir(diretorio, { recursive: true });
      await writeFile(join(diretorio, `${sessao.id}.json`), JSON.stringify(enforcement, null, 2), { mode: 0o600 });
    }
    if (alteracoes.some((change) => change.path.startsWith('.bsh/domains/'))) {
      const relatorio = await validateProject(sessao.caminhoWorktree);
      if (!relatorio.ready) {
        enforcement = { ...enforcement, status: 'violacao', bloquear: true };
        process.stdout.write('BSH enforcement independente: alteracao de ontologia invalida na worktree.\n');
      }
    }
  }
  const exigirDecisao = alerts.length > 0 || enforcement.bloquear || enforcement.status === 'revisao_humana';

  if (exigirDecisao) {
    if (enforcement.bloquear || enforcement.status === 'revisao_humana') {
      process.stdout.write(`\nBSH interceptou a alteracao (enforcement ${enforcement.status}); a promocao exige decisao humana.\n`);
    }
    const aprovado = await confirmException(sessao.branchOrigem);
    if (!aprovado) {
      for (const change of alteracoes) await auditChange(root, domain, change, snapshot, 'deny', 'local-user', 'Excecao negada pelo usuario');
      await gravarSessao(root, sessao, 'DISCARDED');
      await removerSessaoWorktree(sessao, true);
      process.stdout.write('BSH: excecao negada; worktree e branch da sessao removidas. O checkout principal nao foi alterado.\n');
      return { status: 'descartado', promovido: false };
    }
  }

  process.stdout.write('BSH: validando gates na worktree e promovendo por Git...\n');
  await gravarSessao(root, sessao, 'VALIDATING');
  const resultado = await promoverSessao(sessao, { validarGates });
  if (resultado.status === 'promovido') {
    for (const change of alteracoes) await auditChange(root, domain, change, snapshot, 'allow', 'bsh-harness', exigirDecisao ? 'Excecao aprovada pelo usuario' : 'Ontologia respeitada na sessao');
    await gravarSessao(root, sessao, 'PROMOTED');
    await removerSessaoWorktree(sessao, true);
    await gravarSessao(root, sessao, 'CLEANED');
    process.stdout.write(`BSH: ${resultado.detalhes} Worktree temporaria removida.\n`);
    return { status: 'promovido', promovido: true };
  }
  if (resultado.status === 'falha-validacao') {
    await gravarSessao(root, sessao, 'VALIDATION_FAILED');
    process.stdout.write('BSH: a validacao falhou na worktree; nada foi promovido. A branch principal permanece intacta.\n');
    process.stdout.write(`${resultado.detalhes}\n`);
    process.stdout.write('BSH: a worktree foi preservada para correcao; a sessao pode ser retomada ou descartada.\n');
    return { status: 'falha-validacao', promovido: false };
  }
  if (resultado.status === 'conflitado') {
    await gravarSessao(root, sessao, 'CONFLICTED');
    process.stdout.write(`BSH: ${resultado.detalhes}\n`);
    if (resultado.arquivosConflito && resultado.arquivosConflito.length > 0) {
      process.stdout.write(`BSH: arquivos em conflito: ${resultado.arquivosConflito.join(', ')}\n`);
    }
    process.stdout.write('BSH: o conflito permanece somente na worktree; a branch principal nao foi alterada.\n');
    return { status: 'conflitado', promovido: false };
  }
  await gravarSessao(root, sessao, 'PROMOTION_FAILED');
  process.stdout.write(`BSH: promocao nao realizada; a branch principal permanece intacta. ${resultado.detalhes}\n`);
  return { status: 'bloqueado', promovido: false };
}
