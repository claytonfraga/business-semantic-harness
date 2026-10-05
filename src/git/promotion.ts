import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { commitSeNecessario, estaLimpo, git, type SessaoWorktree } from './worktree.js';
import { candidateStillMatches, evaluateGovernance, persistGovernanceDecision, type CandidateFactsExtractor, type GovernanceDecision } from '../enforcement/governanceDecision.js';

const execFileAsync = promisify(execFile);

export interface ResultadoGates {
  ok: boolean;
  saida: string;
}

export type StatusPromocao = 'promovido' | 'bloqueado' | 'conflitado' | 'falha-validacao';

export interface ResultadoPromocao {
  status: StatusPromocao;
  detalhes: string;
  arquivosConflito?: string[];
  etapaBloqueio?: string;
  motivoBloqueio?: string;
  commitIntegrado?: string;
  candidatoAutorizado?: string | null;
}

export interface ResultadoReconciliacao {
  status: 'sincronizado' | 'conflitado' | 'bloqueado';
  detalhes: string;
  arquivosConflito?: string[];
}

export type ValidadorGates = (workspace: string) => Promise<ResultadoGates>;

export async function executarGates(workspace: string): Promise<ResultadoGates> {
  let pacote: { scripts?: Record<string, string> };
  try {
    pacote = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return { ok: true, saida: 'Sem package.json; nenhum gate definido.' };
  }
  const scripts = pacote.scripts ?? {};
  const comandos: string[][] = [];
  if (scripts.quality) comandos.push(['run', 'quality']);
  if (scripts.test) comandos.push(['test']);
  if (comandos.length === 0) return { ok: true, saida: 'Sem gates definidos no projeto.' };
  // A gate is an independent project process. Inheriting Node's parent test
  // runner context would make a nested `node --test` skip all project tests.
  const gateEnvironment = { ...process.env };
  delete gateEnvironment.NODE_TEST_CONTEXT;
  let saida = '';
  for (const argumentos of comandos) {
    try {
      const resultado = await execFileAsync('npm', argumentos, { cwd: workspace, env: gateEnvironment, maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60_000 });
      saida += `$ npm ${argumentos.join(' ')}\n${resultado.stdout}\n`;
    } catch (error) {
      const falha = error as { stdout?: string; stderr?: string; message?: string };
      saida += `$ npm ${argumentos.join(' ')}\n${falha.stdout ?? ''}\n${falha.stderr ?? falha.message ?? ''}\n`;
      return { ok: false, saida };
    }
  }
  return { ok: true, saida };
}

export async function reconciliar(sessao: SessaoWorktree): Promise<ResultadoReconciliacao> {
  if (!(await estaLimpo(sessao.repositorioOrigem))) {
    return { status: 'bloqueado', detalhes: 'O checkout principal tem alteracoes locais; a promocao nao foi iniciada.' };
  }
  const branchAtual = (await git(sessao.repositorioOrigem, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim();
  if (branchAtual !== sessao.branchOrigem) {
    return { status: 'bloqueado', detalhes: `O checkout principal nao esta na branch de origem '${sessao.branchOrigem}' (atual: ${branchAtual || 'detached HEAD'}).` };
  }
  await commitSeNecessario(sessao);
  const referenciaOrigem = (await git(sessao.repositorioOrigem, ['rev-parse', sessao.branchOrigem])).trim();
  if (referenciaOrigem === sessao.commitBase) return { status: 'sincronizado', detalhes: 'Branch de origem nao avancou.' };
  try {
    await git(sessao.caminhoWorktree, ['rebase', sessao.branchOrigem]);
  } catch {
    const conflitos = (await git(sessao.caminhoWorktree, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')).split('\n').filter(Boolean);
    return { status: 'conflitado', detalhes: `A branch ${sessao.branchOrigem} avancou e o rebase gerou conflito na worktree.`, arquivosConflito: conflitos };
  }
  return { status: 'sincronizado', detalhes: 'Worktree reconciliada com a branch de origem.' };
}

export interface OpcoesIntegracao {
  validarGates?: ValidadorGates;
  extractCandidateFacts?: CandidateFactsExtractor;
  onGovernanceDecision?: (decision: GovernanceDecision) => Promise<void>;
}

export async function integrar(sessao: SessaoWorktree, opcoes: OpcoesIntegracao = {}): Promise<ResultadoPromocao> {
  const decision = await evaluateGovernance(sessao, opcoes.extractCandidateFacts);
  await persistGovernanceDecision(sessao.repositorioOrigem, sessao.id, decision).catch(() => undefined);
  await opcoes.onGovernanceDecision?.(structuredClone(decision));
  if (decision.promotionDecision !== 'ALLOW') {
    return {
      status: 'bloqueado',
      detalhes: `Governança ${decision.validationStatus}: ${decision.reason}`,
      etapaBloqueio: decision.failureStage || 'GOVERNANCE_EVALUATION',
      motivoBloqueio: decision.reason,
      candidatoAutorizado: decision.candidateCommit,
    };
  }
  const validarGates = opcoes.validarGates ?? executarGates;
  const gates = await validarGates(sessao.caminhoWorktree);
  if (!gates.ok) {
    return {
      status: 'falha-validacao',
      detalhes: gates.saida,
      etapaBloqueio: 'TECHNICAL_GATES',
      motivoBloqueio: 'Falha na validação dos gates técnicos do projeto',
      candidatoAutorizado: decision.candidateCommit,
    };
  }
  if (!(await candidateStillMatches(sessao, decision))) {
    decision.promotionDecision = 'REVALIDATION_REQUIRED';
    decision.failureStage = 'TOCTOU';
    decision.reason = 'Candidato, ontologia, política ou origin alterados após a validação';
    await persistGovernanceDecision(sessao.repositorioOrigem, sessao.id, decision).catch(() => undefined);
    await opcoes.onGovernanceDecision?.(structuredClone(decision));
    return {
      status: 'bloqueado',
      detalhes: 'REVALIDATION_REQUIRED: candidato, ontologia, política ou origin alterados após a validação',
      etapaBloqueio: 'TOCTOU',
      motivoBloqueio: 'Candidato, ontologia, política ou origin alterados após a validação',
      candidatoAutorizado: decision.candidateCommit,
    };
  }
  try {
    // O hash imutável impede que uma mudança tardia no ponteiro da branch troque o candidato.
    await git(sessao.repositorioOrigem, ['merge', '--ff-only', decision.candidateCommit as string]);
  } catch (error) {
    return {
      status: 'bloqueado',
      detalhes: `Nao foi possivel integrar por fast-forward: ${error instanceof Error ? error.message : String(error)}`,
      etapaBloqueio: 'GIT_MERGE',
      motivoBloqueio: error instanceof Error ? error.message : String(error),
      candidatoAutorizado: decision.candidateCommit,
    };
  }
  const commitIntegrado = (await git(sessao.repositorioOrigem, ['rev-parse', sessao.branchOrigem])).trim();
  if (commitIntegrado !== decision.candidateCommit) {
    return {
      status: 'bloqueado',
      detalhes: `Commit integrado (${commitIntegrado}) diverge do candidato autorizado (${decision.candidateCommit}).`,
      etapaBloqueio: 'COMMIT_VERIFICATION',
      motivoBloqueio: 'Divergência entre commit integrado na origem e candidato autorizado',
      commitIntegrado,
      candidatoAutorizado: decision.candidateCommit,
    };
  }
  decision.originChanged = true;
  await persistGovernanceDecision(sessao.repositorioOrigem, sessao.id, decision).catch(() => undefined);
  await opcoes.onGovernanceDecision?.(structuredClone(decision)).catch(() => undefined);
  return {
    status: 'promovido',
    detalhes: `Alteracoes integradas em ${sessao.branchOrigem}.`,
    commitIntegrado,
    candidatoAutorizado: decision.candidateCommit,
  };
}

export interface OpcoesPromocao {
  validarGates?: ValidadorGates;
  extractCandidateFacts?: CandidateFactsExtractor;
  onGovernanceDecision?: (decision: GovernanceDecision) => Promise<void>;
}

export async function promoverSessao(sessao: SessaoWorktree, opcoes: OpcoesPromocao = {}): Promise<ResultadoPromocao> {
  const reconciliacao = await reconciliar(sessao);
  if (reconciliacao.status === 'conflitado') {
    return {
      status: 'conflitado',
      detalhes: reconciliacao.detalhes,
      arquivosConflito: reconciliacao.arquivosConflito,
      etapaBloqueio: 'RECONCILIATION',
      motivoBloqueio: reconciliacao.detalhes,
    };
  }
  if (reconciliacao.status === 'bloqueado') {
    return {
      status: 'bloqueado',
      detalhes: reconciliacao.detalhes,
      etapaBloqueio: 'RECONCILIATION',
      motivoBloqueio: reconciliacao.detalhes,
    };
  }
  return integrar(sessao, opcoes);
}
