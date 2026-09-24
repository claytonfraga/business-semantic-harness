import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataFactory } from 'n3';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import { parseOntology, parseShapes } from '../ontology/rdf.js';
import { assertOntologySnapshot, type OntologySnapshot } from '../ontology/query.js';
import { validateData, validateProject, type DataValidationResult } from '../ontology/validate.js';
import { BSH_TERMS } from '../vocabulary/bsh.js';

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const SH_TARGET_CLASS = namedNode('http://www.w3.org/ns/shacl#targetClass');

export interface ProposedAction {
  id: string;
  tool: string;
  arguments: unknown;
  domain: string;
  mutates: boolean;
  intercepted: boolean;
  representation?: 'complete' | 'partial' | 'opaque';
  factsTurtle?: string;
  consequences?: string[];
}

export type EvaluationStatus = 'allow' | 'needs-human' | 'deny-on-failure';

export interface ActionEvaluation {
  status: EvaluationStatus;
  actionId: string;
  domain: string;
  snapshotDigest: string;
  actionDigest: string;
  rules: string[];
  reasons: string[];
  confidence: 'complete' | 'partial' | 'opaque';
  shacl?: DataValidationResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function actionDigest(action: ProposedAction, snapshotDigest: string): string {
  return createHash('sha256').update(canonical({
    id: action.id,
    tool: action.tool,
    arguments: action.arguments,
    domain: action.domain,
    mutates: action.mutates,
    intercepted: action.intercepted,
    factsTurtle: action.factsTurtle,
    representation: action.representation,
    snapshotDigest,
  })).digest('hex');
}

export async function evaluateAction(root: string, action: ProposedAction, snapshot: OntologySnapshot): Promise<ActionEvaluation> {
  const base: ActionEvaluation = {
    status: 'deny-on-failure', actionId: action.id, domain: action.domain,
    snapshotDigest: snapshot.digest, actionDigest: actionDigest(action, snapshot.digest), rules: [], reasons: [],
    confidence: action.representation ?? 'opaque',
  };
  if (!action.id || !action.tool || !action.domain || !action.intercepted) {
    base.reasons.push('Ferramenta mutável não interceptada ou identificação incompleta');
    return base;
  }
  try {
    await assertOntologySnapshot(root, snapshot);
    const report = await validateProject(root);
    if (!report.ready) {
      base.reasons.push(...report.issues.map((issue) => `${issue.domain}: ${issue.message}`));
      return base;
    }
  } catch (error) {
    base.reasons.push(error instanceof Error ? error.message : String(error));
    return base;
  }
  if (!action.mutates) {
    base.status = 'allow';
    base.reasons.push('Ação declarada como leitura');
    return base;
  }
  const manifest = await loadManifest(root);
  const domain = manifest.domains.find((item) => item.id === action.domain);
  if (!domain) {
    base.status = 'needs-human';
    base.reasons.push('Domínio da ação não declarado');
    return base;
  }
  if (!action.factsTurtle || action.representation !== 'complete') {
    base.status = 'needs-human';
    base.reasons.push('Ação mutável sem representação RDF completa e confiável');
    return base;
  }
  let facts: ReturnType<typeof parseShapes>;
  try {
    facts = parseShapes(action.factsTurtle);
  } catch {
    base.status = 'needs-human';
    base.reasons.push('Fatos RDF da ação ilegíveis');
    return base;
  }
  const ontology = await parseOntology(await readFile(await resolveProjectFile(root, `.bsh/${domain.ontology}`), 'utf8'));
  const shapes = parseShapes(await readFile(await resolveProjectFile(root, `.bsh/${domain.shapes}`), 'utf8'));
  const classes = new Set(facts.getQuads(null, RDF_TYPE, null, null).filter((q) => q.object.termType === 'NamedNode').map((q) => q.object.value));
  const matchingShapes = shapes.getQuads(null, SH_TARGET_CLASS, null, null).filter((q) => classes.has(q.object.value));
  base.rules.push(...matchingShapes.map((q) => q.subject.value));
  const humanPolicies = ontology.getQuads(null, RDF_TYPE, namedNode(BSH_TERMS.Policy), null)
    .filter((q) => ontology.getQuads(q.subject, namedNode(BSH_TERMS.governs), null, null).some((governs) => classes.has(governs.object.value)))
    .filter((q) => ontology.getQuads(q.subject, namedNode(BSH_TERMS.requiresHumanReview), null, null).some((review) => review.object.value === 'true'));
  base.rules.push(...humanPolicies.map((q) => q.subject.value));
  if (classes.size === 0 || matchingShapes.length === 0 && humanPolicies.length === 0) {
    base.status = 'needs-human';
    base.reasons.push('Tipo da ação ou regra aplicável não representado com confiança');
    return base;
  }
  if (matchingShapes.length > 0) {
    base.shacl = await validateData(shapes, facts);
    if (!base.shacl.conforms) {
      base.status = 'needs-human';
      base.reasons.push(...base.shacl.results.map((result) => result.message || `Violação em ${result.focusNode}`));
    }
  }
  if (humanPolicies.length > 0) {
    base.status = 'needs-human';
    base.reasons.push('Política textual aplicável exige revisão humana');
  }
  if (base.reasons.length === 0) {
    base.status = 'allow';
    base.reasons.push('Ação representada e conforme às restrições aplicáveis');
  }
  return base;
}
