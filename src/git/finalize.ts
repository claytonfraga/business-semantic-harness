import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { appendAudit } from '../decision/audit.js';
import { hashConteudoCodigoBase } from '../enforcement/codigoBase.js';
import { actionDigest, type ProposedAction } from '../decision/evaluate.js';
import type { OntologySnapshot } from '../ontology/query.js';
import { evaluateGovernance, type CandidateFactsExtractor, type GovernanceDecision } from '../enforcement/governanceDecision.js';
import { writeAlerts, type ConflictAlert } from './alerts.js';
import { alteracoesNaWorktree, git, removerSessaoWorktree, type SessaoWorktree } from './worktree.js';
import { executarGates, integrar, reconciliar, type StatusPromocao, type ValidadorGates } from './promotion.js';
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
  confirmar?: (branchOrigem: string) => Promise<boolean>;
  extractCandidateFacts?: CandidateFactsExtractor;
  consultative?: boolean;
  candidateInitialTreeHash?: string;
}

export interface ResultadoFinalizacao {
  status: StatusPromocao | 'sem-alteracoes' | 'descartado';
  promovido: boolean;
}

function buildAction(domain: string, change: FileChange): ProposedAction {
  return {
    id: randomUUID(),
    tool: 'bsh_native_edit',
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
  governance: GovernanceDecision,
): Promise<void> {
  const action = buildAction(domain, change);
  await appendAudit(root, {
    time: new Date().toISOString(),
    actionId: action.id,
    domain,
    actionDigest: actionDigest(action, snapshot.digest),
    snapshotDigest: snapshot.digest,
    rules: governance.selectedShapes,
    evaluation: governance.validationStatus,
    confidence: governance.validationComplete ? 'complete' : 'partial',
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

async function gravarRelatorioSessao(root: string, sessao: SessaoWorktree, dados: Record<string, unknown>): Promise<void> {
  const diretorio = join(root, '.bsh', 'local', 'sessions');
  await mkdir(diretorio, { recursive: true });
  const arquivo = join(diretorio, `${sessao.id}.report.json`);
  let existente: Record<string, unknown> = {};
  try { existente = JSON.parse(await readFile(arquivo, 'utf8')) as Record<string, unknown>; } catch { /* primeiro registro */ }
  await writeFile(arquivo, JSON.stringify({ ...existente, ...dados, atualizadoEm: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export async function finalizeSession(options: FinalizeOptions): Promise<ResultadoFinalizacao> {
  const { sessao, domain, snapshot, alerts, tokenTotals, ontologyQueries, harnessTokens, savings, validarGates } = options;
  const confirmar = options.confirmar ?? confirmException;
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
  const candidateFinalTreeHash = await hashConteudoCodigoBase(sessao.caminhoWorktree);
  process.stdout.write(`BSH: worktree da sessao ${sessao.id} em ${sessao.caminhoWorktree}; branch ${sessao.branchSessao}.\n`);
  {
    const numstatInicial = await git(sessao.caminhoWorktree, ['diff', sessao.commitBase, '--numstat']).catch(() => '');
    let mod = 0; let add = 0; let rem = 0;
    for (const linha of numstatInicial.split('\n')) {
      const partes = linha.split('\t');
      if (partes.length === 3) { mod += 1; if (/^\d+$/.test(partes[0])) add += Number(partes[0]); if (/^\d+$/.test(partes[1])) rem += Number(partes[1]); }
    }
    await gravarRelatorioSessao(root, sessao, {
      alteracaoNaWorktree: alteracoes.length > 0 || mod > 0,
      arquivosModificados: mod, linhasAdicionadas: add, linhasRemovidas: rem,
      worktreeHead: (await git(sessao.caminhoWorktree, ['rev-parse', 'HEAD']).catch(() => '')).trim(),
      origemHeadAntes: (await git(root, ['rev-parse', sessao.branchOrigem]).catch(() => '')).trim(),
      promovido: false, origemAlterada: false, bloqueado: false,
      sessionMode: options.consultative ? 'CONSULTATIVE' : 'ENFORCED',
      candidateInitialTreeHash: options.candidateInitialTreeHash ?? null,
      candidateFinalTreeHash,
      ...(options.consultative ? { enforcementExecutado: false, blockedBySemanticGate: false } : {}),
    });
  }
  if (alteracoes.length === 0 && alerts.length === 0) {
    process.stdout.write('BSH: nenhuma alteracao na worktree; nada a promover.\n');
    await gravarSessao(root, sessao, 'CLEANED');
    await removerSessaoWorktree(sessao, false);
    return { status: 'sem-alteracoes', promovido: false };
  }
  if (alteracoes.length > 0) {
    process.stdout.write(`BSH: ${alteracoes.length} arquivo(s) alterado(s): ${alteracoes.map((change) => change.path).join(', ')}\n`);
  }

  const reconciliacao = await reconciliar(sessao);
  if (reconciliacao.status === 'conflitado') {
    await gravarSessao(root, sessao, 'CONFLICTED');
    process.stdout.write(`BSH: ${reconciliacao.detalhes}\n`);
    if (reconciliacao.arquivosConflito && reconciliacao.arquivosConflito.length > 0) {
      process.stdout.write(`BSH: arquivos em conflito: ${reconciliacao.arquivosConflito.join(', ')}\n`);
    }
    process.stdout.write('BSH: o conflito permanece somente na worktree; a branch principal nao foi alterada.\n');
    return { status: 'conflitado', promovido: false };
  }
  if (reconciliacao.status === 'bloqueado') {
    await gravarSessao(root, sessao, 'PROMOTION_FAILED');
    process.stdout.write(`BSH: promocao nao realizada; a branch principal permanece intacta. ${reconciliacao.detalhes}\n`);
    return { status: 'bloqueado', promovido: false };
  }

  if (options.consultative) {
    // A sessão consultiva oferece MCP ontológico, mas nunca executa o gate semântico.
    // Apenas gates técnicos comuns e a identidade Git do candidato são verificados.
    const candidateCommit = (await git(sessao.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const originCommit = (await git(root, ['rev-parse', sessao.branchOrigem])).trim();
    const candidateClean = (await git(sessao.caminhoWorktree, ['status', '--porcelain'])).trim() === '';
    await gravarRelatorioSessao(root, sessao, {
      enforcementExecutado: false, blockedBySemanticGate: false,
      candidateCommit, origemHeadAntes: originCommit,
    });
    if (!candidateClean || candidateCommit === originCommit) {
      await gravarRelatorioSessao(root, sessao, { bloqueado: !candidateClean || candidateCommit !== originCommit, promotionFailureReason: 'CANDIDATE_STATE' });
      return { status: 'bloqueado', promovido: false };
    }
    const gates = await (validarGates ?? executarGates)(sessao.caminhoWorktree);
    if (!gates.ok) {
      await gravarRelatorioSessao(root, sessao, { bloqueado: true, gatesAprovados: false,
        promotionFailureReason: 'TECHNICAL_GATE' });
      return { status: 'falha-validacao', promovido: false };
    }
    const stillClean = (await git(sessao.caminhoWorktree, ['status', '--porcelain'])).trim() === '';
    const sameCandidate = (await git(sessao.caminhoWorktree, ['rev-parse', 'HEAD'])).trim() === candidateCommit;
    const sameOrigin = (await git(root, ['rev-parse', sessao.branchOrigem])).trim() === originCommit;
    if (!stillClean || !sameCandidate || !sameOrigin) {
      await gravarRelatorioSessao(root, sessao, { bloqueado: true, promotionFailureReason: 'REVALIDATION_REQUIRED' });
      return { status: 'bloqueado', promovido: false };
    }
    try {
      await git(root, ['merge', '--ff-only', candidateCommit]);
    } catch (_error) {
      await gravarRelatorioSessao(root, sessao, { bloqueado: true, promotionFailureReason: 'GIT_MERGE_ERROR' });
      return { status: 'bloqueado', promovido: false };
    }
    const finalCommit = (await git(root, ['rev-parse', sessao.branchOrigem])).trim();
    if (finalCommit !== candidateCommit || finalCommit === originCommit) {
      throw new Error('Promoção consultiva sem evidência Git correspondente');
    }
    await gravarSessao(root, sessao, 'PROMOTED');
    await removerSessaoWorktree(sessao, true);
    await gravarSessao(root, sessao, 'CLEANED');
    await gravarRelatorioSessao(root, sessao, { promovido: true, origemAlterada: true, bloqueado: false,
      gatesAprovados: true, origemHeadDepois: finalCommit });
    process.stdout.write('BSH: candidato consultivo promovido após gates técnicos; sem enforcement semântico. Worktree temporaria removida.\n');
    return { status: 'promovido', promovido: true };
  }

  const recordDecision = async (decision: GovernanceDecision): Promise<void> => {
    const diretorio = join(root, '.bsh', 'local', 'enforcement');
    await mkdir(diretorio, { recursive: true });
    await writeFile(join(diretorio, `${sessao.id}.json`), JSON.stringify(decision, null, 2), { mode: 0o600 });
    await gravarRelatorioSessao(root, sessao, {
      recognizedOperation: decision.recognizedOperation, selectedShapes: decision.selectedShapes,
      executedShapes: decision.executedShapes, factsExtracted: decision.factsExtracted,
      coveredPaths: decision.coveredPaths,
      missingFacts: decision.missingFacts, candidateGraphHash: decision.candidateGraphHash,
      validationStatus: decision.validationStatus, violations: decision.violations,
      policyDecision: decision.policyDecision, candidateFingerprint: decision.candidateFingerprint,
      promotionDecision: decision.promotionDecision, originChanged: decision.originChanged,
      failureStage: decision.failureStage,
    });
  };
  const governance = await evaluateGovernance(sessao, options.extractCandidateFacts);
  await recordDecision(governance);
  const numstat = await git(sessao.caminhoWorktree, ['diff', sessao.commitBase, '--numstat']).catch(() => '');
  let arquivosModificados = 0; let linhasAdicionadas = 0; let linhasRemovidas = 0;
  for (const linha of numstat.split('\n')) {
    const partes = linha.split('\t');
    if (partes.length === 3) {
      arquivosModificados += 1;
      if (/^\d+$/.test(partes[0])) linhasAdicionadas += Number(partes[0]);
      if (/^\d+$/.test(partes[1])) linhasRemovidas += Number(partes[1]);
    }
  }
  const diffTexto = await git(sessao.caminhoWorktree, ['diff', sessao.commitBase]).catch(() => '');
  await gravarRelatorioSessao(root, sessao, {
    alteracaoNaWorktree: alteracoes.length > 0 || arquivosModificados > 0,
    arquivosModificados, linhasAdicionadas, linhasRemovidas,
    hashDiff: createHash('sha256').update(diffTexto).digest('hex'),
    worktreeHead: (await git(sessao.caminhoWorktree, ['rev-parse', 'HEAD']).catch(() => '')).trim(),
    origemHeadAntes: (await git(root, ['rev-parse', sessao.branchOrigem]).catch(() => '')).trim(),
    enforcementExecutado: governance.validationExecuted,
    statusEnforcement: governance.validationStatus,
    enforcement: governance.results,
  });

  if (governance.promotionDecision !== 'ALLOW') {
    for (const change of alteracoes) await auditChange(root, domain, change, snapshot, 'deny', 'bsh-harness', governance.reason, governance);
    await gravarSessao(root, sessao, 'VALIDATION_FAILED');
    await gravarRelatorioSessao(root, sessao, { bloqueado: true, promovido: false, origemAlterada: false });
    process.stdout.write(`BSH: promoção bloqueada pela governança (${governance.validationStatus}): ${governance.reason}.\n`);
    return { status: 'bloqueado', promovido: false };
  }

  const exigirDecisao = alerts.length > 0;

  if (exigirDecisao) {
    const aprovado = await confirmar(sessao.branchOrigem);
    if (!aprovado) {
      for (const change of alteracoes) await auditChange(root, domain, change, snapshot, 'deny', 'local-user', 'Excecao negada pelo usuario', governance);
      await gravarSessao(root, sessao, 'DISCARDED');
      await removerSessaoWorktree(sessao, true);
      await gravarRelatorioSessao(root, sessao, { bloqueado: alteracoes.length > 0, promovido: false, origemAlterada: false });
      process.stdout.write('BSH: excecao negada; worktree e branch da sessao removidas. O checkout principal nao foi alterado.\n');
      return { status: 'descartado', promovido: false };
    }
  }

  process.stdout.write('BSH: validando gates na worktree e promovendo por Git...\n');
  await gravarSessao(root, sessao, 'VALIDATING');
  const resultado = await integrar(sessao, { validarGates, extractCandidateFacts: options.extractCandidateFacts,
    onGovernanceDecision: recordDecision });
  if (resultado.status === 'promovido') {
    for (const change of alteracoes) await auditChange(root, domain, change, snapshot, 'allow', 'bsh-harness', exigirDecisao ? 'Excecao aprovada pelo usuario' : 'Estado candidato validado e conforme', governance);
    await gravarSessao(root, sessao, 'PROMOTED');
    await removerSessaoWorktree(sessao, true);
    await gravarSessao(root, sessao, 'CLEANED');
    await gravarRelatorioSessao(root, sessao, { promovido: true, origemAlterada: true, gatesAprovados: true, origemHeadDepois: (await git(root, ['rev-parse', sessao.branchOrigem]).catch(() => '')).trim() });
    process.stdout.write(`BSH: ${resultado.detalhes} Worktree temporaria removida.\n`);
    return { status: 'promovido', promovido: true };
  }
  if (resultado.status === 'falha-validacao') {
    await gravarSessao(root, sessao, 'VALIDATION_FAILED');
    await gravarRelatorioSessao(root, sessao, { gatesAprovados: false, promovido: false, origemAlterada: false });
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
