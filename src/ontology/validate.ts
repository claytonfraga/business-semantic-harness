import { readFile } from 'node:fs/promises';
import { DataFactory, Store } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import { ORACLE_TERMS } from '../vocabulary/oracle.js';
import { parseOntology, parseShapes } from './rdf.js';

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class');
const OWL_CLASS = namedNode('http://www.w3.org/2002/07/owl#Class');
const SH_NODE_SHAPE = namedNode('http://www.w3.org/ns/shacl#NodeShape');
const SH_TARGET_CLASS = namedNode('http://www.w3.org/ns/shacl#targetClass');
const SH_PROPERTY = namedNode('http://www.w3.org/ns/shacl#property');

export interface ValidationIssue {
  domain: string;
  file: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationReport {
  ok: boolean;
  ready: boolean;
  issues: ValidationIssue[];
}

export interface DataValidationResult {
  conforms: boolean;
  results: Array<{ shape: string; focusNode: string; message: string; severity: string }>;
}

export async function validateData(shapes: Store, data: Store): Promise<DataValidationResult> {
  const report = await new SHACLValidator(shapes).validate(data);
  return {
    conforms: report.conforms,
    results: report.results.map((item) => ({
      shape: item.sourceShape?.value ?? '',
      focusNode: item.focusNode?.value ?? '',
      message: item.message.map((term) => term.value).join('; '),
      severity: item.severity?.value ?? '',
    })),
  };
}

function add(issues: ValidationIssue[], domain: string, file: string, rule: string, message: string): void {
  issues.push({ domain, file, rule, message, severity: 'error' });
}

function definitions(store: Store): Map<string, string> {
  const result = new Map<string, string>();
  const subjects = new Set(store.getQuads(null, null, null, null).filter((q) => q.subject.termType === 'NamedNode').map((q) => q.subject.value));
  for (const subject of subjects) {
    const entries = store.getQuads(namedNode(subject), null, null, null)
      .map((q) => `${q.predicate.value}=${q.object.termType}:${q.object.value}`)
      .sort();
    result.set(subject, entries.join('|'));
  }
  return result;
}

export async function validateProject(root: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  let manifest;
  try {
    manifest = await loadManifest(root);
  } catch (error) {
    add(issues, 'project', '.oracle/project.json', 'manifest', error instanceof Error ? error.message : String(error));
    return { ok: false, ready: false, issues };
  }
  if (manifest.domains.length === 0) {
    add(issues, 'project', '.oracle/project.json', 'no-domains', 'Projeto sem domínios declarados');
  }
  const seen = new Map<string, { definition: string; domain: string; file: string }>();
  for (const domain of manifest.domains) {
    let ontology: Store;
    let shapes: Store;
    try {
      ontology = await parseOntology(await readFile(await resolveProjectFile(root, `.oracle/${domain.ontology}`), 'utf8'));
    } catch (error) {
      add(issues, domain.id, domain.ontology, 'ontology-load', error instanceof Error ? error.message : String(error));
      continue;
    }
    try {
      shapes = parseShapes(await readFile(await resolveProjectFile(root, `.oracle/${domain.shapes}`), 'utf8'));
    } catch (error) {
      add(issues, domain.id, domain.shapes, 'shapes-load', error instanceof Error ? error.message : String(error));
      continue;
    }

    const domainNodes = ontology.getQuads(null, RDF_TYPE, namedNode(ORACLE_TERMS.Domain), null);
    const versions = domainNodes.flatMap((q) => ontology.getQuads(q.subject, namedNode(ORACLE_TERMS.version), null, null).map((v) => v.object.value));
    if (versions.length !== 1 || versions[0] !== domain.version || !/^1\./.test(versions[0])) {
      add(issues, domain.id, domain.ontology, 'ontology-version', `Versão da ontologia incompatível: esperado ${domain.version}, encontrado ${versions.join(', ') || 'ausente'}`);
    }
    const classes = [...ontology.getQuads(null, RDF_TYPE, RDFS_CLASS, null), ...ontology.getQuads(null, RDF_TYPE, OWL_CLASS, null)];
    if (classes.length === 0) {
      add(issues, domain.id, domain.ontology, 'business-concept', 'Domínio sem conceito de negócio declarado');
    }
    const activeShapes = shapes.getQuads(null, RDF_TYPE, SH_NODE_SHAPE, null)
      .filter((q) => shapes.countQuads(q.subject, SH_TARGET_CLASS, null, null) > 0 && shapes.countQuads(q.subject, SH_PROPERTY, null, null) > 0);
    if (activeShapes.length === 0) {
      add(issues, domain.id, domain.shapes, 'active-shape', 'Domínio sem shape ativo com alvo e restrição');
    }
    for (const q of ontology.getQuads(null, namedNode(ORACLE_TERMS.governs), null, null)) {
      if (q.object.termType === 'NamedNode' && q.object.value.startsWith(domain.baseIri) && ontology.countQuads(q.object, null, null, null) === 0) {
        add(issues, domain.id, domain.ontology, 'unresolved-reference', `Referência local sem definição: ${q.object.value}`);
      }
    }
    for (const [iri, definition] of definitions(ontology)) {
      const prior = seen.get(iri);
      if (prior && prior.definition !== definition) {
        add(issues, domain.id, domain.ontology, 'duplicate-iri', `IRI ${iri} tem definições incompatíveis em ${prior.domain} (${prior.file}) e ${domain.id} (${domain.ontology})`);
      } else if (!prior) {
        seen.set(iri, { definition, domain: domain.id, file: domain.ontology });
      }
    }
    try {
      await validateData(shapes, ontology);
    } catch (error) {
      add(issues, domain.id, domain.shapes, 'shacl-graph', error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: issues.length === 0, ready: issues.length === 0, issues };
}
