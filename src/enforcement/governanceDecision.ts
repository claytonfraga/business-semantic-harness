import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DataFactory } from 'n3';
import { aplicarRegras, lerDiff } from './extratorOperacoes.js';
import { carregarRegrasGovernanca } from './governanca.js';
import { validarOperacao } from './validadorSemantico.js';
import type { OperacaoSemantica, ResultadoEnforcement } from './operacaoSemantica.js';
import { createOntologySnapshot } from '../ontology/query.js';
import { validateProject } from '../ontology/validate.js';
import { loadManifest } from '../project/manifest.js';
import { parseShapes } from '../ontology/rdf.js';
import { resolveProjectFile } from '../project/paths.js';
import { git, type SessaoWorktree } from '../git/worktree.js';

export type SemanticStatus = 'CONFORMING' | 'VIOLATION' | 'INDETERMINATE' | 'VALIDATION_ERROR';
export type PromotionDecision = 'ALLOW' | 'DENY' | 'REVALIDATION_REQUIRED';
export type FailureStage = 'RECOGNITION' | 'FACT_EXTRACTION' | 'CANDIDATE_STATE' |
  'SHAPE_SELECTION' | 'VALIDATION_EXECUTION' | 'AGGREGATION' | 'POLICY' |
  'PROMOTION_GATE' | 'TOCTOU';

/** Implementado pelo host, com acesso ao estado candidato. O agente não fornece esta prova. */
export interface CandidateFacts {
  graphTurtle: string;
  coveredPaths: string[];
  sourceCommit: string;
}

export type CandidateFactsExtractor = (input: {
  workspace: string;
  sourceCommit: string;
  originCommit: string;
  operation: OperacaoSemantica;
  relevantPaths: readonly string[];
}) => Promise<CandidateFacts>;

export interface GovernanceDecision {
  recognizedOperation: string[];
  selectedShapes: string[];
  executedShapes: string[];
  factsExtracted: string[];
  coveredPaths: string[];
  missingFacts: string[];
  candidateGraphHash: string | null;
  validationStatus: SemanticStatus;
  validationExecuted: boolean;
  validationComplete: boolean;
  violations: string[];
  policyDecision: 'ALLOW' | 'DENY';
  promotionDecision: PromotionDecision;
  reason: string;
  failureStage: FailureStage | null;
  candidateFingerprint: string | null;
  candidateCommit: string | null;
  originCommit: string | null;
  ontologyHash: string | null;
  policyHash: string | null;
  results: ResultadoEnforcement[];
  originChanged: boolean;
}

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const unique = (values: string[]): string[] => [...new Set(values)].sort();
const SH_TARGET_CLASS = DataFactory.namedNode('http://www.w3.org/ns/shacl#targetClass');
const VALIDATION_TIMEOUT_MS = 60_000;

async function bounded<T>(stage: string, pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${stage}: timeout da validação semântica`)), VALIDATION_TIMEOUT_MS);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function selectedShapes(root: string, operation: OperacaoSemantica): Promise<string[]> {
  const manifest = await loadManifest(root);
  const domain = manifest.domains.find((item) => item.id === operation.dominio);
  if (!domain) throw new Error(`Domínio reconhecido não declarado: ${operation.dominio}`);
  const target = operation.operacao.startsWith('urn:') || operation.operacao.startsWith('http:') ||
    operation.operacao.startsWith('https:') ? operation.operacao : `${domain.baseIri}${operation.operacao}`;
  const shapes = parseShapes(await readFile(await resolveProjectFile(root, `.bsh/${domain.shapes}`), 'utf8'));
  return unique(shapes.getQuads(null, SH_TARGET_CLASS, DataFactory.namedNode(target), null)
    .map((quad) => quad.subject.value));
}

function denied(status: SemanticStatus, reason: string, failureStage: FailureStage | null = null): GovernanceDecision {
  return {
    recognizedOperation: [], selectedShapes: [], executedShapes: [], factsExtracted: [], coveredPaths: [], missingFacts: [],
    candidateGraphHash: null, validationStatus: status, validationExecuted: false, validationComplete: false,
    violations: [], policyDecision: 'DENY', promotionDecision: 'DENY', reason,
    failureStage, candidateFingerprint: null, candidateCommit: null, originCommit: null,
    ontologyHash: null, policyHash: null, results: [], originChanged: false,
  };
}

async function policyHash(root: string): Promise<string> {
  const manifest = await loadManifest(root);
  const parts: string[] = [];
  for (const domain of manifest.domains) {
    const path = `.bsh/${dirname(domain.ontology)}/enforcement.json`;
    try {
      parts.push(`${path}\0${sha(await readFile(await resolveProjectFile(root, path), 'utf8'))}`);
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      parts.push(`${path}\0MISSING`);
    }
  }
  return sha(parts.sort().join('\0'));
}

async function fingerprint(session: SessaoWorktree, originCommit: string, candidateCommit: string,
  ontologyHash: string, rulesHash: string, graphHashes: string[]): Promise<string> {
  const diff = await git(session.caminhoWorktree, ['diff', '--binary', originCommit, candidateCommit]);
  const status = await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all']);
  return sha(JSON.stringify({ baseCommit: session.commitBase, originCommit, candidateCommit,
    diffHash: sha(diff), worktreeStatus: status, candidateGraphHashes: graphHashes.sort(),
    ontologyHash, policyHash: rulesHash }));
}

export async function evaluateGovernance(session: SessaoWorktree,
  extractFacts?: CandidateFactsExtractor): Promise<GovernanceDecision> {
  const root = session.repositorioOrigem;
  const baseHadManifest = await git(root, ['cat-file', '-e', `${session.commitBase}:.bsh/project.json`])
    .then(() => true, () => false);
  try {
    await access(join(root, '.bsh', 'project.json'));
  } catch (error) {
    if (baseHadManifest) return denied('VALIDATION_ERROR', 'Manifesto BSH ausente após o início da sessão', 'PROMOTION_GATE');
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
      return denied('VALIDATION_ERROR', 'Manifesto BSH indisponível', 'PROMOTION_GATE');
    }
    // Repositórios sem BSH continuam disponíveis para os testes genéricos do módulo Git.
    const decision = denied('CONFORMING', 'Projeto sem configuração BSH');
    decision.validationExecuted = true;
    decision.validationComplete = true;
    decision.policyDecision = 'ALLOW';
    decision.promotionDecision = 'ALLOW';
    decision.originCommit = (await git(root, ['rev-parse', session.branchOrigem])).trim();
    decision.candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    if ((await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      return denied('INDETERMINATE', 'Candidato sem commit estável para validação', 'CANDIDATE_STATE');
    }
    decision.candidateFingerprint = await fingerprint(session, decision.originCommit, decision.candidateCommit, '', '', []);
    return decision;
  }
  const decision = denied('INDETERMINATE', 'Validação semântica não concluída');
  try {
    const originCommit = (await git(root, ['rev-parse', session.branchOrigem])).trim();
    const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    if ((await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      return denied('INDETERMINATE', 'Candidato sem commit estável para validação', 'CANDIDATE_STATE');
    }
    decision.originCommit = originCommit;
    decision.candidateCommit = candidateCommit;
    const snapshot = await createOntologySnapshot(root);
    const baselineValidation = await bounded('baseline', validateProject(root));
    if (!baselineValidation.ready) {
      decision.validationStatus = 'VALIDATION_ERROR';
      decision.reason = `Base semântica original inválida: ${baselineValidation.issues.map((issue) => issue.message).join('; ')}`;
      decision.failureStage = 'CANDIDATE_STATE';
      return decision;
    }
    const rulesHash = await policyHash(root);
    decision.ontologyHash = snapshot.digest;
    decision.policyHash = rulesHash;
    const paths = (await git(session.caminhoWorktree, ['diff', '--name-only', '-z', originCommit, candidateCommit]))
      .split('\0').filter(Boolean);
    const rules = await carregarRegrasGovernanca(root);
    // Sem uma prova confiável de irrelevância, todo arquivo do diff é relevante.
    // Uma regra que deixa de reconhecer o candidato não pode liberar a promoção.
    const relevantPaths = unique(paths);
    const graphHashes: string[] = [];
    if (paths.some((path) => path.startsWith('.bsh/'))) {
      const report = await bounded('candidate ontology', validateProject(session.caminhoWorktree));
      if (!report.ready) {
        decision.validationStatus = 'VIOLATION';
        decision.violations = report.issues.map((issue) => issue.message);
        decision.reason = 'Base semântica candidata inválida';
      }
    }
    const operations = aplicarRegras(rules, await lerDiff(session.caminhoWorktree, originCommit));
    decision.recognizedOperation = unique(operations.map((operation) => operation.operacao));
    const covered = new Set<string>();
    const validationErrors: Array<{ stage: FailureStage; message: string }> = [];
    for (const operation of operations) {
      let stage: FailureStage = 'SHAPE_SELECTION';
      try {
        const shapes = await selectedShapes(root, operation);
        decision.selectedShapes.push(...shapes);
        if (shapes.length === 0) {
          for (const path of relevantPaths) covered.add(path);
          decision.results.push({
            operacao: operation.operacao,
            dominio: operation.dominio,
            status: 'conforme',
            governado: true,
            requerRevisaoHumana: false,
            shapesAvaliados: [],
            politicas: [],
            proveniencia: operation.proveniencia,
            evidencia: [],
            selectedShapes: [],
            executedShapes: [],
            missingFacts: [],
            validationExecuted: true,
            validationComplete: true,
          });
          continue;
        }
        if (!extractFacts) {
          decision.missingFacts.push(`Estado candidato não extraído para ${operation.operacao}`);
          continue;
        }
        stage = 'FACT_EXTRACTION';
        const facts = await bounded('fact extraction', extractFacts({ workspace: session.caminhoWorktree,
          sourceCommit: candidateCommit, originCommit, operation, relevantPaths }));
        if (!facts || facts.sourceCommit !== candidateCommit || !facts.graphTurtle?.trim() ||
          !Array.isArray(facts.coveredPaths) || facts.coveredPaths.some((path) => !relevantPaths.includes(path))) {
          decision.missingFacts.push(`Proveniência incompleta dos fatos de ${operation.operacao}`);
          continue;
        }
        for (const path of facts.coveredPaths) covered.add(path);
        graphHashes.push(sha(facts.graphTurtle));
        stage = 'VALIDATION_EXECUTION';
        const result = await bounded('SHACL', validarOperacao(root, snapshot, { ...operation, fatos: [],
          candidateGraphTurtle: facts.graphTurtle }));
        decision.results.push(result);
        decision.selectedShapes.push(...result.selectedShapes ?? []);
        decision.executedShapes.push(...result.executedShapes ?? []);
        decision.missingFacts.push(...result.missingFacts ?? []);
        decision.factsExtracted.push(...parseShapes(facts.graphTurtle).getQuads(null, null, null, null)
          .map((quad) => `${quad.subject.value} ${quad.predicate.value} ${quad.object.value}`));
        if (result.status === 'violacao') decision.violations.push(...result.evidencia);
      } catch (error) {
        validationErrors.push({ stage,
          message: `${operation.operacao}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    decision.selectedShapes = unique(decision.selectedShapes);
    decision.executedShapes = unique(decision.executedShapes);
    decision.factsExtracted = unique(decision.factsExtracted);
    decision.coveredPaths = unique([...covered]);
    decision.missingFacts.push(...relevantPaths.filter((path) => !covered.has(path)));
    decision.missingFacts = unique(decision.missingFacts);
    decision.candidateGraphHash = graphHashes.length ? sha(graphHashes.sort().join('\0')) : null;
    decision.validationExecuted = relevantPaths.length === 0 ||
      operations.length > 0 && decision.results.length === operations.length &&
      decision.results.every((result) => result.validationExecuted);
    decision.validationComplete = decision.validationExecuted && decision.missingFacts.length === 0 &&
      decision.selectedShapes.every((shape) => decision.executedShapes.includes(shape)) &&
      decision.results.every((result) => result.validationComplete);
    if (decision.violations.length > 0) {
      decision.validationStatus = 'VIOLATION';
      decision.reason = 'Violação encontrada na validação semântica';
      decision.failureStage = null;
    } else if (validationErrors.length > 0) {
      decision.validationStatus = 'VALIDATION_ERROR';
      decision.reason = validationErrors.map((error) => error.message).join('; ');
      decision.failureStage = validationErrors[0].stage;
    } else if (decision.results.some((result) => result.status === 'revisao_humana' || result.status === 'indeterminado') ||
      !decision.validationComplete) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = relevantPaths.length > 0 && operations.length === 0 ? 'RECOGNITION'
        : decision.missingFacts.length > 0 ? 'FACT_EXTRACTION'
          : decision.selectedShapes.length === 0 ? 'SHAPE_SELECTION'
          : decision.selectedShapes.some((shape) => !decision.executedShapes.includes(shape)) ? 'VALIDATION_EXECUTION'
            : 'CANDIDATE_STATE';
      decision.reason = `Fatos, shapes ou validação incompletos (${decision.failureStage}: missing=[${decision.missingFacts.join(',')}], selected=[${decision.selectedShapes.join(',')}], ops=${operations.length})`;
    } else {
      decision.validationStatus = 'CONFORMING';
      decision.reason = 'Estado candidato validado e conforme';
      decision.failureStage = null;
    }
    decision.candidateFingerprint = await fingerprint(session, originCommit, candidateCommit,
      snapshot.digest, rulesHash, graphHashes);
    if ((await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      decision.validationStatus = 'INDETERMINATE';
      decision.reason = 'Worktree alterada durante a validação; nova validação necessária';
      decision.validationComplete = false;
      decision.failureStage = 'TOCTOU';
    }
    if (decision.validationStatus === 'CONFORMING' && decision.validationExecuted && decision.validationComplete) {
      decision.policyDecision = 'ALLOW';
      decision.promotionDecision = 'ALLOW';
    }
  } catch (error) {
    if (decision.violations.length > 0) {
      decision.validationStatus = 'VIOLATION';
      decision.reason = `Violação detectada; falha adicional: ${error instanceof Error ? error.message : String(error)}`;
    } else {
      decision.validationStatus = 'VALIDATION_ERROR';
      decision.reason = error instanceof Error ? error.message : String(error);
      decision.failureStage = 'VALIDATION_EXECUTION';
    }
    decision.policyDecision = 'DENY';
    decision.promotionDecision = 'DENY';
  }
  return decision;
}

export async function candidateStillMatches(session: SessaoWorktree, decision: GovernanceDecision): Promise<boolean> {
  if (decision.promotionDecision !== 'ALLOW' || !decision.candidateFingerprint || !decision.candidateCommit ||
    !decision.originCommit || decision.policyDecision !== 'ALLOW' || decision.validationStatus !== 'CONFORMING' ||
    !decision.validationExecuted || !decision.validationComplete) return false;
  try {
    const activeBranch = (await git(session.repositorioOrigem, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    if (activeBranch !== session.branchOrigem) return false;
    if ((await git(session.repositorioOrigem, ['status', '--porcelain', '--untracked-files=all'])).trim()) return false;
    const origin = (await git(session.repositorioOrigem, ['rev-parse', session.branchOrigem])).trim();
    const head = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    if (origin !== decision.originCommit || head !== decision.candidateCommit) return false;
    if ((await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim()) return false;
    const ontology = await createOntologySnapshot(session.repositorioOrigem).catch(() => null);
    const currentOntology = ontology?.digest ?? '';
    if (currentOntology !== (decision.ontologyHash ?? '')) return false;
    const currentPolicy = ontology ? await policyHash(session.repositorioOrigem) : '';
    if (currentPolicy !== (decision.policyHash ?? '')) return false;
    // O grafo validado integra o fingerprint original; o commit e a worktree devem permanecer imóveis.
    const calculated = await fingerprint(session, origin, head, currentOntology, currentPolicy,
      decision.results.map((result) => result.candidateGraphHash).filter((hash): hash is string => !!hash));
    return calculated === decision.candidateFingerprint;
  } catch {
    return false;
  }
}
