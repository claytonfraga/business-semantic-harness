import { readFile } from 'node:fs/promises';
import { DataFactory, type Store } from 'n3';
import { parseShapes } from '../ontology/rdf.js';
import { resolveProjectFile } from '../project/paths.js';
import type { RegraGovernanca } from './governanca.js';
import type { AuditEvent } from '../decision/audit.js';

export type ContractChangeType =
  | 'shape_weakening'
  | 'shape_modification'
  | 'policy_weakening'
  | 'policy_change'
  | 'query_modification'
  | 'extractor_modification'
  | 'contract_evolution';

export interface ContractChange {
  type: ContractChangeType;
  path: string;
  detail: string;
  severity: 'weakening' | 'modification' | 'evolution';
  requiresMeaningReview?: boolean;
}

export interface ContractAnalysisResult {
  isContractChange: boolean;
  isFunctionalChange: boolean;
  contractPaths: string[];
  functionalPaths: string[];
  changes: ContractChange[];
  weakeningDetected: boolean;
  requiresMeaningReview: boolean;
  details: string[];
}

export interface ContractApprovalRecord {
  responsible: string;
  justification: string;
  version: string;
  commit: string;
  approvedAt?: string;
  meaningReviewJustification?: string;
}

export interface EvaluatingBaseIdentity {
  commit: string;
  ontologyHash: string;
  policyHash: string;
  manifestProjectId?: string;
  evaluatingTimestamp: string;
}

const SH_TARGET_CLASS = DataFactory.namedNode('http://www.w3.org/ns/shacl#targetClass');
const SH_PROPERTY = DataFactory.namedNode('http://www.w3.org/ns/shacl#property');
const SH_MIN_COUNT = DataFactory.namedNode('http://www.w3.org/ns/shacl#minCount');
const SH_CONSTRAINTS = ['minCount', 'maxCount', 'in', 'datatype', 'class', 'pattern', 'nodeKind', 'hasValue', 'disjoint', 'sparql']
  .map((term) => DataFactory.namedNode(`http://www.w3.org/ns/shacl#${term}`));

export function isContractPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return (
    normalized.startsWith('.bsh/') ||
    normalized.endsWith('.rq') ||
    normalized.includes('/queries/') ||
    normalized.endsWith('shapes.ttl') ||
    normalized.endsWith('ontology.jsonld') ||
    normalized.endsWith('enforcement.json') ||
    normalized.endsWith('regras.json')
  );
}

export function compareShapeStores(baseStore: Store, candidateStore: Store, path: string): ContractChange[] {
  const changes: ContractChange[] = [];

  // 1. Check target classes
  const baseTargetQuads = baseStore.getQuads(null, SH_TARGET_CLASS, null, null);
  const candidateTargetQuads = candidateStore.getQuads(null, SH_TARGET_CLASS, null, null);
  const candidateTargetValues = new Set(candidateTargetQuads.map((q) => q.object.value));

  for (const bq of baseTargetQuads) {
    if (!candidateTargetValues.has(bq.object.value)) {
      changes.push({
        type: 'shape_weakening',
        path,
        detail: `TargetClass '${bq.object.value}' da shape '${bq.subject.value}' foi removida no candidato`,
        severity: 'weakening',
      });
    }
  }

  // 2. Check minCount constraints
  const baseMinCountQuads = baseStore.getQuads(null, SH_MIN_COUNT, null, null);
  for (const bmc of baseMinCountQuads) {
    const baseCount = parseInt(bmc.object.value, 10) || 0;
    const candMinQuads = candidateStore.getQuads(bmc.subject, SH_MIN_COUNT, null, null);
    if (candMinQuads.length === 0) {
      changes.push({
        type: 'shape_weakening',
        path,
        detail: `Restrição sh:minCount em '${bmc.subject.value}' foi removida no candidato`,
        severity: 'weakening',
      });
    } else {
      const candCount = parseInt(candMinQuads[0].object.value, 10) || 0;
      if (candCount < baseCount) {
        changes.push({
          type: 'shape_weakening',
          path,
          detail: `Restrição sh:minCount em '${bmc.subject.value}' foi reduzida de ${baseCount} para ${candCount}`,
          severity: 'weakening',
        });
      }
    }
  }

  // 3. Check property shapes count
  const basePropQuads = baseStore.getQuads(null, SH_PROPERTY, null, null);
  const candPropQuads = candidateStore.getQuads(null, SH_PROPERTY, null, null);
  if (candPropQuads.length < basePropQuads.length) {
    changes.push({
      type: 'shape_weakening',
      path,
      detail: `Candidato reduziu o número de propriedades monitoradas (base: ${basePropQuads.length}, candidato: ${candPropQuads.length})`,
      severity: 'weakening',
    });
  }

  // 4. Check total constraint components
  let baseConstraints = 0;
  let candConstraints = 0;
  for (const c of SH_CONSTRAINTS) {
    baseConstraints += baseStore.countQuads(null, c, null, null);
    candConstraints += candidateStore.countQuads(null, c, null, null);
  }
  if (candConstraints < baseConstraints && !changes.some((c) => c.severity === 'weakening')) {
    changes.push({
      type: 'shape_weakening',
      path,
      detail: `Candidato reduziu restrições SHACL (base: ${baseConstraints}, candidato: ${candConstraints})`,
      severity: 'weakening',
    });
  } else if (changes.length === 0 && (candConstraints !== baseConstraints || candPropQuads.length !== basePropQuads.length)) {
    changes.push({
      type: 'shape_modification',
      path,
      detail: 'Shape modificada no candidato',
      severity: 'modification',
    });
  }

  return changes;
}

export function compareGovernancePolicies(baseRules: RegraGovernanca[], candRules: RegraGovernanca[], path: string): ContractChange[] {
  const changes: ContractChange[] = [];
  const candRuleMap = new Map(candRules.map((r) => [r.id, r]));

  for (const bRule of baseRules) {
    const candRule = candRuleMap.get(bRule.id);
    if (!candRule) {
      changes.push({
        type: 'policy_weakening',
        path,
        detail: `Regra de governança '${bRule.id}' (${bRule.operacao}) foi removida no candidato`,
        severity: 'weakening',
      });
      continue;
    }

    const bEvs = bRule.evidenciasRequeridas ?? [];
    const cEvs = candRule.evidenciasRequeridas ?? [];
    if (cEvs.length < bEvs.length) {
      changes.push({
        type: 'policy_weakening',
        path,
        detail: `Evidências requeridas para regra '${bRule.id}' foram reduzidas no candidato`,
        severity: 'weakening',
      });
    }
  }

  if (candRules.length < baseRules.length && !changes.some((c) => c.type === 'policy_weakening')) {
    changes.push({
      type: 'policy_weakening',
      path,
      detail: `Candidato reduziu a quantidade total de regras de governança (base: ${baseRules.length}, candidato: ${candRules.length})`,
      severity: 'weakening',
    });
  } else if (changes.length === 0 && JSON.stringify(baseRules) !== JSON.stringify(candRules)) {
    changes.push({
      type: 'policy_change',
      path,
      detail: 'Políticas de governança atualizadas no candidato',
      severity: 'modification',
    });
  }

  return changes;
}

export function compareQueryContent(baseContent: string, candidateContent: string, path: string): ContractChange[] {
  const changes: ContractChange[] = [];
  if (baseContent.trim() !== candidateContent.trim()) {
    changes.push({
      type: 'query_modification',
      path,
      detail: `Consulta SPARQL que seleciona evidências foi modificada no candidato (${path})`,
      severity: 'modification',
      requiresMeaningReview: true,
    });
  }
  return changes;
}

export async function analyzeContractChanges(params: {
  root: string;
  candidateWorkspace: string;
  paths: readonly string[];
  subgraphSelection?: {
    query?: string;
    queryModified?: boolean;
    altersEvidenceSelection?: boolean;
    omitsAuthorizations?: boolean;
    omitsRelatedStates?: boolean;
  };
}): Promise<ContractAnalysisResult> {
  const { root, candidateWorkspace, paths, subgraphSelection } = params;
  const contractPaths = paths.filter(isContractPath);
  const functionalPaths = paths.filter((p) => !isContractPath(p));
  const isContract = contractPaths.length > 0;
  const isFunctional = functionalPaths.length > 0;

  const changes: ContractChange[] = [];

  for (const path of contractPaths) {
    if (path.endsWith('shapes.ttl')) {
      try {
        const basePath = await resolveProjectFile(root, path);
        const candPath = await resolveProjectFile(candidateWorkspace, path);
        const baseShapes = parseShapes(await readFile(basePath, 'utf8'));
        const candShapes = parseShapes(await readFile(candPath, 'utf8'));
        changes.push(...compareShapeStores(baseShapes, candShapes, path));
      } catch {
        changes.push({
          type: 'shape_weakening',
          path,
          detail: `Arquivo de shapes inacessível ou removido no candidato: ${path}`,
          severity: 'weakening',
        });
      }
    } else if (path.endsWith('enforcement.json') || path.endsWith('regras.json')) {
      try {
        const basePath = await resolveProjectFile(root, path);
        const candPath = await resolveProjectFile(candidateWorkspace, path);
        const baseRules = (JSON.parse(await readFile(basePath, 'utf8')).regras ?? []) as RegraGovernanca[];
        const candRules = (JSON.parse(await readFile(candPath, 'utf8')).regras ?? []) as RegraGovernanca[];
        changes.push(...compareGovernancePolicies(baseRules, candRules, path));
      } catch {
        changes.push({
          type: 'policy_weakening',
          path,
          detail: `Arquivo de regras de governança inacessível ou removido: ${path}`,
          severity: 'weakening',
        });
      }
    } else if (path.endsWith('.rq') || path.includes('/queries/')) {
      try {
        const basePath = await resolveProjectFile(root, path);
        const candPath = await resolveProjectFile(candidateWorkspace, path);
        const baseText = await readFile(basePath, 'utf8');
        const candText = await readFile(candPath, 'utf8');
        changes.push(...compareQueryContent(baseText, candText, path));
      } catch {
        changes.push({
          type: 'query_modification',
          path,
          detail: `Arquivo de consulta SPARQL modificado ou removido: ${path}`,
          severity: 'modification',
          requiresMeaningReview: true,
        });
      }
    } else {
      changes.push({
        type: 'contract_evolution',
        path,
        detail: `Arquivo de contrato semântico alterado: ${path}`,
        severity: 'evolution',
      });
    }
  }

  if (subgraphSelection?.queryModified || subgraphSelection?.altersEvidenceSelection) {
    changes.push({
      type: 'query_modification',
      path: 'subgraphSelection',
      detail: 'Consulta SPARQL de seleção de evidências/subgrafos alterada no candidato',
      severity: 'modification',
      requiresMeaningReview: true,
    });
  }

  const weakeningDetected = changes.some((c) => c.severity === 'weakening');
  const requiresMeaningReview = changes.some((c) => c.requiresMeaningReview === true);

  return {
    isContractChange: isContract,
    isFunctionalChange: isFunctional,
    contractPaths,
    functionalPaths,
    changes,
    weakeningDetected,
    requiresMeaningReview,
    details: changes.map((c) => c.detail),
  };
}

export function findBoundContractApproval(
  auditEvents: Array<AuditEvent & {
    candidateCommit?: string;
    version?: string;
    responsible?: string;
    justification?: string;
    meaningReviewJustification?: string;
  }>,
  candidateCommit: string,
  expectedVersion?: string,
): ContractApprovalRecord | null {
  for (const event of auditEvents) {
    if (
      event.decision === 'allow' &&
      event.candidateCommit === candidateCommit &&
      (event.evaluation === 'contract-approval' ||
       event.actionId?.startsWith('contract-approval') ||
       event.rules?.includes('domain-contract-approval'))
    ) {
      const responsible = (event.responsible || event.actor || '').trim();
      const justification = (event.justification || event.reason || '').trim();
      const version = (
        event.version ||
        (event.authorizedArguments as { version?: string } | undefined)?.version ||
        expectedVersion ||
        '1.0.0'
      ).trim();

      if (responsible && justification && version) {
        return {
          responsible,
          justification,
          version,
          commit: candidateCommit,
          approvedAt: event.time,
          meaningReviewJustification:
            event.meaningReviewJustification ||
            (event.authorizedArguments as { meaningReviewJustification?: string } | undefined)?.meaningReviewJustification,
        };
      }
    }
  }
  return null;
}
