import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DataFactory } from 'n3';
import { aplicarRegras, lerDiff, paraRegex } from './extratorOperacoes.js';
import { carregarRegrasGovernanca } from './governanca.js';
import { validarOperacao } from './validadorSemantico.js';
import { resolveOperationDomain } from './identidadeOperacao.js';
import type { OperacaoSemantica, ResultadoEnforcement } from './operacaoSemantica.js';
import { createOntologySnapshot } from '../ontology/query.js';
import { validateProject } from '../ontology/validate.js';
import { loadManifest } from '../project/manifest.js';
import { parseShapes } from '../ontology/rdf.js';
import { resolveProjectFile } from '../project/paths.js';
import { git, type SessaoWorktree } from '../git/worktree.js';
import { readAudit, type AuditEvent } from '../decision/audit.js';
import {
  analyzeContractChanges,
  findBoundContractApproval,
  type ContractAnalysisResult,
  type ContractApprovalRecord,
  type ContractChange,
  type EvaluatingBaseIdentity,
} from './contractGovernance.js';

export type { ContractAnalysisResult, ContractApprovalRecord, ContractChange, EvaluatingBaseIdentity };

export type SemanticStatus = 'CONFORMING' | 'VIOLATION' | 'INDETERMINATE' | 'VALIDATION_ERROR';
export type PromotionDecision = 'ALLOW' | 'DENY' | 'REVALIDATION_REQUIRED';
export type FailureStage = 'RECOGNITION' | 'FACT_EXTRACTION' | 'CANDIDATE_STATE' |
  'SHAPE_SELECTION' | 'VALIDATION_EXECUTION' | 'AGGREGATION' | 'POLICY' |
  'PROMOTION_GATE' | 'TOCTOU';

export interface PathCoverageBinding {
  path: string;
  operationId: string;
  operationName: string;
  ruleId: string;
  evidence: string;
  evidenceType: 'structural' | 'behavioral';
  origin?: string;
  method?: string;
  scope?: string;
  symbol?: string;
  scenario?: string;
  requirement?: string;
}

export interface FileCoverageReport {
  totalPaths: string[];
  coveredPaths: string[];
  uncoveredPaths: string[];
  ratio: number;
}

export interface RuleCoverageReport {
  totalRules: string[];
  appliedRules: string[];
  unappliedRules: string[];
  satisfiedRules: string[];
}

export interface EvidenceSufficiencyDetail {
  operation: string;
  ruleId: string;
  status: 'SUFFICIENT' | 'INSUFFICIENT';
  requiredEvidenceTypes: Array<'structural' | 'behavioral'>;
  providedEvidenceTypes: Array<'structural' | 'behavioral'>;
  missingRequirements: string[];
}

export interface EvidenceSufficiencyReport {
  sufficient: boolean;
  details: EvidenceSufficiencyDetail[];
}

export interface CandidateEvidenceItem {
  id?: string;
  path: string;
  type: 'structural' | 'behavioral';
  description?: string;
  graphTurtle?: string;
}

export interface AdapterIdentification {
  id: string;
  name: string;
  version: string;
  technology: string;
  supportedOperations: string[];
}

export interface CorrespondenceBinding {
  operation: string;
  ruleId: string;
  path: string;
  symbol?: string;
  conditionDescription?: string;
}

export interface SparqlEvidenceRecord {
  query: string;
  source: string;
  results: unknown;
  executionTimestamp: string;
}

export interface ExternalDataSourceRecord {
  source: string;
  versionOrHash: string;
  consistencyPolicy: 'SNAPSHOT_PINNED' | 'REVALIDATE_ON_DECISION' | 'STRICT_IMMUTABLE';
  verifiedAt: string;
  revalidated: boolean;
}

export interface ContentIdentification {
  identificationType: 'CONTENT_HASH';
  isCertification: false; // Hashes are content identification, not authority certification
  ontologyHash: string | null;
  policyHash: string | null;
  candidateGraphHash: string | null;
  candidateFingerprint: string | null;
}

/** Implementado pelo host, com acesso ao estado candidato. O agente não fornece esta prova. */
export interface CandidateFacts {
  graphTurtle: string;
  coveredPaths: string[];
  sourceCommit: string;
  structuralEvidence?: string[];
  behavioralEvidence?: string[];
  evidenceItems?: CandidateEvidenceItem[];
  evidenceType?: 'structural' | 'behavioral';
  missingRequirements?: string[];
  subgraphSelection?: {
    query?: string;
    preservedAuthorizations?: string[];
    preservedStates?: string[];
    omitsAuthorizations?: boolean;
    omitsRelatedStates?: boolean;
  };
  adaptersUsed?: AdapterIdentification[];
  sparqlEvidences?: SparqlEvidenceRecord[];
  externalDataSources?: ExternalDataSourceRecord[];
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
  coverageBindings: PathCoverageBinding[];
  fileCoverage: FileCoverageReport;
  ruleCoverage: RuleCoverageReport;
  evidenceSufficiency: EvidenceSufficiencyReport;
  structuralEvidence: string[];
  behavioralEvidence: string[];
  isContractChange: boolean;
  isFunctionalChange: boolean;
  contractPaths: string[];
  functionalPaths: string[];
  contractApprovalDecision: 'ALLOW' | 'DENY' | 'REQUIRES_CONTRACT_APPROVAL' | 'NOT_APPLICABLE';
  contractApproval: ContractApprovalRecord | null;
  contractWeakeningDetected: boolean;
  contractChanges: ContractChange[];
  evaluatingBaseIdentity: EvaluatingBaseIdentity;
  requiresMeaningReview: boolean;
  meaningReviewCompleted: boolean;
  adaptersUsed: AdapterIdentification[];
  policiesUsed: string[];
  correspondencesUsed: CorrespondenceBinding[];
  sparqlEvidences: SparqlEvidenceRecord[];
  externalDataSources: ExternalDataSourceRecord[];
  contentIdentification: ContentIdentification;
  factsGraphTurtle?: string;
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
  const identity = await resolveOperationDomain(root, operation);
  const domain = identity.domain;
  const target = identity.iri;
  const shapes = parseShapes(await readFile(await resolveProjectFile(root, `.bsh/${domain.shapes}`), 'utf8'));
  for (const depDomain of identity.domains) {
    if (depDomain.id !== domain.id) {
      const depShapes = parseShapes(await readFile(await resolveProjectFile(root, `.bsh/${depDomain.shapes}`), 'utf8'));
      shapes.addQuads(depShapes.getQuads(null, null, null, null));
    }
  }
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
    coverageBindings: [],
    fileCoverage: { totalPaths: [], coveredPaths: [], uncoveredPaths: [], ratio: 0 },
    ruleCoverage: { totalRules: [], appliedRules: [], unappliedRules: [], satisfiedRules: [] },
    evidenceSufficiency: { sufficient: false, details: [] },
    structuralEvidence: [],
    behavioralEvidence: [],
    isContractChange: false,
    isFunctionalChange: false,
    contractPaths: [],
    functionalPaths: [],
    contractApprovalDecision: 'NOT_APPLICABLE',
    contractApproval: null,
    contractWeakeningDetected: false,
    contractChanges: [],
    evaluatingBaseIdentity: {
      commit: '',
      ontologyHash: '',
      policyHash: '',
      evaluatingTimestamp: new Date().toISOString(),
    },
    requiresMeaningReview: false,
    meaningReviewCompleted: false,
    adaptersUsed: [],
    policiesUsed: [],
    correspondencesUsed: [],
    sparqlEvidences: [],
    externalDataSources: [],
    contentIdentification: {
      identificationType: 'CONTENT_HASH',
      isCertification: false,
      ontologyHash: null,
      policyHash: null,
      candidateGraphHash: null,
      candidateFingerprint: null,
    },
    factsGraphTurtle: '',
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

function hasBoundHumanDecision(
  auditEvents: Array<AuditEvent & { candidateCommit?: string }>,
  candidateCommit: string,
  policies: string[],
): boolean {
  if (policies.length === 0) return true;
  return policies.every((policy) =>
    auditEvents.some((event) =>
      event.actor === 'human' &&
      event.decision === 'allow' &&
      event.candidateCommit === candidateCommit &&
      (!event.rules || event.rules.length === 0 || event.rules.includes(policy))
    )
  );
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
    decision.evaluatingBaseIdentity = {
      commit: originCommit,
      ontologyHash: snapshot.digest,
      policyHash: rulesHash,
      manifestProjectId: snapshot.projectId,
      evaluatingTimestamp: new Date().toISOString(),
    };
    const paths = (await git(session.caminhoWorktree, ['diff', '--name-only', '-z', originCommit, candidateCommit]))
      .split('\0').filter(Boolean);
    const contractAnalysis = await analyzeContractChanges({
      root,
      candidateWorkspace: session.caminhoWorktree,
      paths,
    });
    decision.isContractChange = contractAnalysis.isContractChange;
    decision.isFunctionalChange = contractAnalysis.isFunctionalChange;
    decision.contractPaths = contractAnalysis.contractPaths;
    decision.functionalPaths = contractAnalysis.functionalPaths;
    decision.contractChanges = contractAnalysis.changes;
    decision.contractWeakeningDetected = contractAnalysis.weakeningDetected;
    decision.requiresMeaningReview = contractAnalysis.requiresMeaningReview;
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
    const allGraphTurtles: string[] = [];
    for (const operation of operations) {
      let stage: FailureStage = 'SHAPE_SELECTION';
      const opRule = rules.find((r) => r.id === operation.regraId);
      try {
        const shapes = await selectedShapes(root, operation);
        decision.selectedShapes.push(...shapes);
        const resultIndex = decision.results.length;
        decision.results.push(await validarOperacao(root, snapshot, { ...operation, fatos: [] },
          { requireCandidateEvidence: true }));
        if (!extractFacts) {
          if (shapes.length > 0) decision.missingFacts.push(`Independent candidate evidence is missing for ${operation.operacao}`);
          decision.evidenceSufficiency.details.push({
            operation: operation.operacao,
            ruleId: operation.regraId ?? opRule?.id ?? 'unknown-rule',
            status: 'INSUFFICIENT',
            requiredEvidenceTypes: (opRule?.evidenciasRequeridas ?? []).map((e) => e.tipo === 'estrutural' ? 'structural' : 'behavioral'),
            providedEvidenceTypes: [],
            missingRequirements: ['Candidate facts extractor not provided'],
          });
          continue;
        }
        stage = 'FACT_EXTRACTION';
        const opRelated = operation.alteracoesRelacionadas.filter((p) => relevantPaths.includes(p));
        const pathsForOp = opRelated.length > 0 ? opRelated : relevantPaths;
        const facts = await bounded('fact extraction', extractFacts({ workspace: session.caminhoWorktree,
          sourceCommit: candidateCommit, originCommit, operation, relevantPaths: pathsForOp }));
        if (!facts || facts.sourceCommit !== candidateCommit || !facts.graphTurtle?.trim() ||
          !Array.isArray(facts.coveredPaths) || facts.coveredPaths.some((path) => !relevantPaths.includes(path))) {
          decision.missingFacts.push(`Proveniência incompleta dos fatos de ${operation.operacao}`);
          decision.evidenceSufficiency.details.push({
            operation: operation.operacao,
            ruleId: operation.regraId ?? opRule?.id ?? 'unknown-rule',
            status: 'INSUFFICIENT',
            requiredEvidenceTypes: (opRule?.evidenciasRequeridas ?? []).map((e) => e.tipo === 'estrutural' ? 'structural' : 'behavioral'),
            providedEvidenceTypes: [],
            missingRequirements: [`Proveniência incompleta dos fatos de ${operation.operacao}`],
          });
          continue;
        }

        allGraphTurtles.push(facts.graphTurtle);
        if (facts.adaptersUsed) {
          for (const adapter of facts.adaptersUsed) {
            if (!decision.adaptersUsed.some((a) => a.id === adapter.id)) {
              decision.adaptersUsed.push(adapter);
            }
          }
        }
        if (facts.sparqlEvidences) {
          decision.sparqlEvidences.push(...facts.sparqlEvidences);
        }
        if (facts.externalDataSources) {
          decision.externalDataSources.push(...facts.externalDataSources);
        }
        if (facts.subgraphSelection?.query) {
          decision.sparqlEvidences.push({
            query: facts.subgraphSelection.query,
            source: 'candidate_subgraph_selection',
            results: {
              preservedAuthorizations: facts.subgraphSelection.preservedAuthorizations ?? [],
              preservedStates: facts.subgraphSelection.preservedStates ?? [],
            },
            executionTimestamp: new Date().toISOString(),
          });
        }

        const matchedPaths: string[] = [];
        for (const path of facts.coveredPaths) {
          const rulePatternMatches = opRule ? paraRegex(opRule.quando.caminho).test(path) : false;
          const isRelated = operation.alteracoesRelacionadas.includes(path) || rulePatternMatches;
          if (!isRelated) {
            continue;
          }
          matchedPaths.push(path);
          covered.add(path);
          const evidenceItem = facts.evidenceItems?.find((e) => e.path === path);
          const isBehavioral = evidenceItem?.type === 'behavioral' ||
            facts.behavioralEvidence?.includes(path) ||
            facts.evidenceType === 'behavioral';
          const evType: 'structural' | 'behavioral' = isBehavioral ? 'behavioral' : 'structural';
          const evidenceId = evidenceItem?.id ?? `${facts.sourceCommit}:${path}`;
          if (facts.behavioralEvidence && facts.behavioralEvidence.length > 0) {
            decision.behavioralEvidence.push(...facts.behavioralEvidence);
          } else if (evType === 'behavioral') {
            decision.behavioralEvidence.push(evidenceId);
          }
          if (facts.structuralEvidence && facts.structuralEvidence.length > 0) {
            decision.structuralEvidence.push(...facts.structuralEvidence);
          } else if (evType === 'structural') {
            decision.structuralEvidence.push(evidenceId);
          }
          decision.coverageBindings.push({
            path,
            operationId: operation.id,
            operationName: operation.operacao,
            ruleId: operation.regraId ?? opRule?.id ?? 'unknown-rule',
            evidence: evidenceId,
            evidenceType: evType,
            origin: `candidate_workspace:${path}`,
            method: isBehavioral ? 'CAUSAL_EXECUTION_TRACE' : 'STRUCTURAL_EXTRACTION',
            scope: path,
            symbol: operation.operacao,
            scenario: opRule?.quando?.caminho ?? path,
            requirement: opRule?.id ?? operation.operacao,
          });
        }

        const requiredTypes: Array<'structural' | 'behavioral'> = (opRule?.evidenciasRequeridas ?? [])
          .map((e) => e.tipo === 'estrutural' ? 'structural' : 'behavioral');
        const providedTypes: Array<'structural' | 'behavioral'> = [];
        if (decision.structuralEvidence.length > 0 || matchedPaths.some((p) => !facts.behavioralEvidence?.includes(p))) {
          providedTypes.push('structural');
        }
        if (decision.behavioralEvidence.length > 0 || facts.evidenceType === 'behavioral') {
          providedTypes.push('behavioral');
        }
        const missingReqs: string[] = [];
        if (facts.missingRequirements && facts.missingRequirements.length > 0) {
          missingReqs.push(...facts.missingRequirements);
        }
        for (const req of (opRule?.evidenciasRequeridas ?? [])) {
          const t = req.tipo === 'estrutural' ? 'structural' : 'behavioral';
          if (!providedTypes.includes(t)) {
            missingReqs.push(`Falta evidência ${req.tipo} para regra ${opRule?.id}`);
          }
        }
        if (facts.subgraphSelection?.omitsAuthorizations) {
          missingReqs.push('Recorte SPARQL omitiu autorizações exigidas pela decisão');
        }
        if (facts.subgraphSelection?.omitsRelatedStates) {
          missingReqs.push('Recorte SPARQL omitiu estados relacionados exigidos pela decisão');
        }
        const opSufficient = missingReqs.length === 0 && facts.graphTurtle.trim().length > 0;
        decision.evidenceSufficiency.details.push({
          operation: operation.operacao,
          ruleId: operation.regraId ?? opRule?.id ?? 'unknown-rule',
          status: opSufficient ? 'SUFFICIENT' : 'INSUFFICIENT',
          requiredEvidenceTypes: requiredTypes,
          providedEvidenceTypes: [...new Set(providedTypes)],
          missingRequirements: missingReqs,
        });

        graphHashes.push(sha(facts.graphTurtle));
        if (!opSufficient) {
          decision.missingFacts.push(...missingReqs);
          continue;
        }
        stage = 'VALIDATION_EXECUTION';
        const result = await bounded('SHACL', validarOperacao(root, snapshot, { ...operation, fatos: [],
          candidateGraphTurtle: facts.graphTurtle }, { requireCandidateEvidence: true }));
        decision.results[resultIndex] = result;
        decision.selectedShapes.push(...result.selectedShapes ?? []);
        decision.executedShapes.push(...result.executedShapes ?? []);
        decision.missingFacts.push(...result.missingFacts ?? []);
        decision.factsExtracted.push(...parseShapes(facts.graphTurtle).getQuads(null, null, null, null)
          .map((quad) => `${quad.subject.value} ${quad.predicate.value} ${quad.object.value}`));
        if (result.status === 'violacao') decision.violations.push(...result.evidencia);

        if (result.validationResults) {
          for (const vr of result.validationResults) {
            if (vr.mechanism === 'SHACL_SPARQL') {
              decision.sparqlEvidences.push({
                query: 'constraint' in vr ? String((vr as { constraint?: string }).constraint) : vr.shape,
                source: 'shacl_sparql_constraint',
                results: vr,
                executionTimestamp: new Date().toISOString(),
              });
            }
          }
        }
        if (Array.isArray(operation.dependenciasDominio)) {
          for (const dep of operation.dependenciasDominio) {
            if (!decision.externalDataSources.some((s) => s.source === `domain_dependency:${dep}`)) {
              decision.externalDataSources.push({
                source: `domain_dependency:${dep}`,
                versionOrHash: sha(dep),
                consistencyPolicy: 'SNAPSHOT_PINNED',
                verifiedAt: new Date().toISOString(),
                revalidated: true,
              });
            }
          }
        }
      } catch (error) {
        validationErrors.push({ stage,
          message: `${operation.operacao}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    decision.factsGraphTurtle = allGraphTurtles.join('\n');
    decision.policiesUsed = unique([...rules.map((r) => r.id), ...decision.selectedShapes]);
    decision.correspondencesUsed = operations.map((op) => {
      const matchedRule = rules.find((r) => r.id === op.regraId);
      return {
        operation: op.operacao,
        ruleId: op.regraId ?? 'unknown',
        path: op.alteracoesRelacionadas[0] ?? '',
        symbol: op.operacao,
        conditionDescription: matchedRule ? JSON.stringify(matchedRule.quando) : undefined,
      };
    });
    decision.selectedShapes = unique(decision.selectedShapes);
    decision.executedShapes = unique(decision.executedShapes);
    decision.factsExtracted = unique(decision.factsExtracted);
    decision.structuralEvidence = unique(decision.structuralEvidence);
    decision.behavioralEvidence = unique(decision.behavioralEvidence);
    decision.coveredPaths = unique([...covered]);
    decision.coverageBindings = decision.coverageBindings.filter(
      (b, idx, arr) => arr.findIndex((x) => x.path === b.path && x.operationId === b.operationId) === idx,
    );
    decision.missingFacts.push(...relevantPaths.filter((path) => !covered.has(path)));
    decision.missingFacts = unique(decision.missingFacts);
    decision.candidateGraphHash = graphHashes.length ? sha(graphHashes.sort().join('\0')) : null;

    const coveredArr = unique([...covered]);
    decision.fileCoverage = {
      totalPaths: relevantPaths,
      coveredPaths: coveredArr,
      uncoveredPaths: relevantPaths.filter((p) => !covered.has(p)),
      ratio: relevantPaths.length > 0 ? coveredArr.length / relevantPaths.length : 1,
    };
    const totalRuleIds = unique(rules.map((r) => r.id));
    const appliedRuleIds = unique(operations.map((o) => o.regraId).filter(Boolean) as string[]);
    const satisfiedRuleIds = unique(
      decision.evidenceSufficiency.details.filter((d) => d.status === 'SUFFICIENT').map((d) => d.ruleId),
    );
    decision.ruleCoverage = {
      totalRules: totalRuleIds,
      appliedRules: appliedRuleIds,
      unappliedRules: totalRuleIds.filter((id) => !appliedRuleIds.includes(id)),
      satisfiedRules: satisfiedRuleIds,
    };
    decision.evidenceSufficiency.sufficient = operations.length > 0 &&
      decision.evidenceSufficiency.details.length === operations.length &&
      decision.evidenceSufficiency.details.every((d) => d.status === 'SUFFICIENT');

    decision.validationExecuted = operations.length > 0 &&
      decision.results.length === operations.length &&
      decision.results.every((result) => result.validationExecuted === true);
    decision.validationComplete = decision.validationExecuted && decision.missingFacts.length === 0 &&
      decision.selectedShapes.every((shape) => decision.executedShapes.includes(shape)) &&
      decision.results.length === operations.length && decision.results.every((result) => result.validationComplete);
    const auditEvents = (await readAudit(root).catch(() => [])) as Array<AuditEvent & { candidateCommit?: string }>;
    if (decision.isContractChange) {
      const boundContractApproval = findBoundContractApproval(auditEvents, candidateCommit);
      if (boundContractApproval) {
        decision.contractApproval = boundContractApproval;
        if (decision.requiresMeaningReview) {
          const hasMeaningReview = Boolean(
            boundContractApproval.meaningReviewJustification?.trim() ||
            boundContractApproval.justification.toLowerCase().includes('significado') ||
            boundContractApproval.justification.toLowerCase().includes('meaning') ||
            boundContractApproval.justification.toLowerCase().includes('evidence selection')
          );
          if (hasMeaningReview) {
            decision.meaningReviewCompleted = true;
            decision.contractApprovalDecision = 'ALLOW';
          } else {
            decision.meaningReviewCompleted = false;
            decision.contractApprovalDecision = 'DENY';
          }
        } else {
          decision.contractApprovalDecision = 'ALLOW';
        }
      } else {
        decision.contractApprovalDecision = 'DENY';
      }
    } else {
      decision.contractApprovalDecision = 'NOT_APPLICABLE';
    }

    const pendingHumanReview = decision.results.some((result) => {
      if (!result.requerRevisaoHumana) return false;
      const humanPolicies = result.politicasHumanas ?? result.politicas ?? [];
      const approved = hasBoundHumanDecision(auditEvents, candidateCommit, humanPolicies);
      if (approved) {
        result.decisaoHumanaVinculada = true;
        if (result.status === 'revisao_humana' && result.validationExecuted && (result.validationResults?.length ?? 0) === 0) {
          result.status = 'conforme';
        }
      }
      return !approved;
    });
    if (decision.violations.length > 0) {
      decision.validationStatus = 'VIOLATION';
      decision.reason = 'Violação encontrada na validação semântica';
      decision.failureStage = null;
    } else if (validationErrors.length > 0) {
      decision.validationStatus = 'VALIDATION_ERROR';
      decision.reason = validationErrors.map((error) => error.message).join('; ');
      decision.failureStage = validationErrors[0].stage;
    } else if (decision.isContractChange && decision.contractApprovalDecision !== 'ALLOW') {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = 'POLICY';
      if (decision.contractWeakeningDetected) {
        decision.reason = 'Enfraquecimento de restrições do contrato detectado no candidato; o agente não pode se auto-autorizar por regras enfraquecidas';
      } else if (decision.requiresMeaningReview && !decision.meaningReviewCompleted) {
        decision.reason = 'Mudanças em consultas que alterem a seleção de evidências exigem revisão de significado aprovada';
      } else {
        decision.reason = 'Alterações no contrato de domínio exigem aprovação de contrato com responsável, justificativa, versão e commit vinculados';
      }
    } else if (decision.isFunctionalChange && operations.length === 0) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = 'RECOGNITION';
      decision.reason = 'Nenhuma operação de governança reconhecida para as alterações do diff';
    } else if (pendingHumanReview) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = 'POLICY';
      decision.reason = 'Human review requires a recorded decision bound to this candidate; action approvals are insufficient';
    } else if (decision.isFunctionalChange && decision.selectedShapes.length === 0 && operations.length > 0) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = 'SHAPE_SELECTION';
      decision.reason = `Fatos, shapes ou validação incompletos (SHAPE_SELECTION: missing=[${decision.missingFacts.join(',')}], selected=[], ops=${operations.length})`;
    } else if (decision.isFunctionalChange && (!decision.evidenceSufficiency.sufficient || decision.missingFacts.length > 0)) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = 'FACT_EXTRACTION';
      decision.reason = `Evidências insuficientes ou fatos ausentes: ${[...decision.missingFacts, ...decision.evidenceSufficiency.details.flatMap((d) => d.missingRequirements)].filter(Boolean).join('; ')}`;
    } else if (decision.isFunctionalChange && (decision.results.some((result) => result.status === 'revisao_humana' || result.status === 'indeterminado') ||
      !decision.validationComplete)) {
      decision.validationStatus = 'INDETERMINATE';
      decision.failureStage = decision.selectedShapes.some((shape) => !decision.executedShapes.includes(shape)) ? 'VALIDATION_EXECUTION'
        : 'CANDIDATE_STATE';
      decision.reason = `Fatos, shapes ou validação incompletos (${decision.failureStage}: missing=[${decision.missingFacts.join(',')}], selected=[${decision.selectedShapes.join(',')}], ops=${operations.length})`;
    } else {
      decision.validationStatus = 'CONFORMING';
      decision.reason = decision.isContractChange
        ? 'Alterações do contrato de domínio aprovadas por responsável formal'
        : 'Estado candidato validado e conforme';
      decision.failureStage = null;
      if (decision.isContractChange && !decision.isFunctionalChange) {
        decision.validationExecuted = true;
        decision.validationComplete = true;
      }
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
      if (decision.isContractChange && decision.contractApprovalDecision !== 'ALLOW') {
        decision.policyDecision = 'DENY';
        decision.promotionDecision = 'DENY';
      } else {
        decision.policyDecision = 'ALLOW';
        decision.promotionDecision = 'ALLOW';
      }
    } else {
      decision.policyDecision = 'DENY';
      decision.promotionDecision = 'DENY';
    }
    decision.contentIdentification = {
      identificationType: 'CONTENT_HASH',
      isCertification: false,
      ontologyHash: decision.ontologyHash,
      policyHash: decision.policyHash,
      candidateGraphHash: decision.candidateGraphHash,
      candidateFingerprint: decision.candidateFingerprint,
    };
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
    decision.contentIdentification = {
      identificationType: 'CONTENT_HASH',
      isCertification: false,
      ontologyHash: decision.ontologyHash,
      policyHash: decision.policyHash,
      candidateGraphHash: decision.candidateGraphHash,
      candidateFingerprint: decision.candidateFingerprint,
    };
  }
  return decision;
}

export async function candidateStillMatches(session: SessaoWorktree, decision: GovernanceDecision): Promise<boolean> {
  if (decision.promotionDecision !== 'ALLOW' || !decision.candidateFingerprint || !decision.candidateCommit ||
    !decision.originCommit || decision.policyDecision !== 'ALLOW' || decision.validationStatus !== 'CONFORMING' ||
    (!decision.validationExecuted && decision.ontologyHash !== null) || !decision.validationComplete) return false;
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

/**
 * Persists the complete governance decision record and updates the session report.
 */
export async function persistGovernanceDecision(
  root: string,
  sessionId: string,
  decision: GovernanceDecision,
): Promise<string> {
  const directory = join(root, '.bsh', 'local', 'enforcement');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = join(directory, `${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(decision, null, 2), { mode: 0o600 });

  const sessionDir = join(root, '.bsh', 'local', 'sessions');
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const reportPath = join(sessionDir, `${sessionId}.report.json`);
  let existingReport: Record<string, unknown> = {};
  try {
    existingReport = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    // initial report
  }
  const updatedReport = {
    ...existingReport,
    lastGovernanceDecision: {
      validationStatus: decision.validationStatus,
      promotionDecision: decision.promotionDecision,
      policyDecision: decision.policyDecision,
      evaluatingBaseIdentity: decision.evaluatingBaseIdentity,
      candidateFingerprint: decision.candidateFingerprint,
      contentIdentification: decision.contentIdentification,
      factsExtractedCount: decision.factsExtracted.length,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeFile(reportPath, JSON.stringify(updatedReport, null, 2), { mode: 0o600 });
  return filePath;
}

/**
 * Loads a persisted governance decision from the repository.
 */
export async function loadGovernanceDecision(
  root: string,
  sessionId: string,
): Promise<GovernanceDecision> {
  const filePath = join(root, '.bsh', 'local', 'enforcement', `${sessionId}.json`);
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as GovernanceDecision;
}
