import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataFactory } from 'n3';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import { ORACLE_TERMS } from '../vocabulary/oracle.js';
import { parseOntology, parseShapes } from './rdf.js';

const { namedNode } = DataFactory;

export interface QueryStatement {
  predicate: string;
  value: string;
}

export interface QueryEntry {
  iri: string;
  source: string;
  statements: QueryStatement[];
  relations: Array<{ subject: string; predicate: string }>;
  governedBy: Array<{ iri: string; description: string; requiresHumanReview: boolean }>;
}

export interface QueryResult {
  domain: string;
  version: string;
  source: string;
  entries: QueryEntry[];
  shapes: Array<{ iri: string; source: string; target: string; statements: QueryStatement[] }>;
}

export async function queryOntology(root: string, domainId: string, iri?: string): Promise<QueryResult> {
  const manifest = await loadManifest(root);
  const domain = manifest.domains.find((candidate) => candidate.id === domainId);
  if (!domain) throw new Error(`Domínio não declarado: ${domainId}`);
  const store = await parseOntology(await readFile(await resolveProjectFile(root, `.oracle/${domain.ontology}`), 'utf8'));
  const shapeStore = parseShapes(await readFile(await resolveProjectFile(root, `.oracle/${domain.shapes}`), 'utf8'));
  const subjects = iri
    ? [iri]
    : [...new Set(store.getQuads(null, null, null, null).filter((q) => q.subject.termType === 'NamedNode').map((q) => q.subject.value))].sort();
  const entries = subjects.map((subject): QueryEntry => {
    const statements = store.getQuads(namedNode(subject), null, null, null).map((q) => ({ predicate: q.predicate.value, value: q.object.value }));
    const governedBy = store.getQuads(null, namedNode(ORACLE_TERMS.governs), namedNode(subject), null).map((q) => ({
      iri: q.subject.value,
      description: store.getQuads(q.subject, namedNode('http://www.w3.org/2000/01/rdf-schema#comment'), null, null).map((item) => item.object.value).join('; '),
      requiresHumanReview: store.getQuads(q.subject, namedNode(ORACLE_TERMS.requiresHumanReview), null, null).some((item) => item.object.value === 'true'),
    }));
    const relations = store.getQuads(null, null, namedNode(subject), null).map((q) => ({ subject: q.subject.value, predicate: q.predicate.value }));
    return { iri: subject, source: domain.ontology, statements, relations, governedBy };
  }).filter((entry) => entry.statements.length > 0);
  const targetPredicate = namedNode('http://www.w3.org/ns/shacl#targetClass');
  const shapes = shapeStore.getQuads(null, targetPredicate, null, null)
    .filter((q) => !iri || q.object.value === iri || q.subject.value === iri)
    .map((q) => ({
      iri: q.subject.value,
      source: domain.shapes,
      target: q.object.value,
      statements: shapeStore.getQuads(q.subject, null, null, null).flatMap((statement) => {
        const direct = { predicate: statement.predicate.value, value: statement.object.value };
        if (statement.object.termType !== 'BlankNode') return [direct];
        return [direct, ...shapeStore.getQuads(statement.object, null, null, null).map((nested) => ({
          predicate: `${statement.predicate.value}/${nested.predicate.value}`,
          value: nested.object.value,
        }))];
      }),
    }));
  if (iri && entries.length === 0 && shapes.length === 0) {
    throw new Error(`IRI não encontrado no domínio ${domainId}: ${iri}`);
  }
  return { domain: domainId, version: domain.version, source: domain.ontology, entries, shapes };
}

export interface OntologySnapshot {
  projectId: string;
  digest: string;
  files: readonly string[];
}

export async function createOntologySnapshot(root: string): Promise<OntologySnapshot> {
  const manifest = await loadManifest(root);
  const files = ['project.json', ...manifest.domains.flatMap((domain) => [domain.ontology, domain.shapes])].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(await resolveProjectFile(root, `.oracle/${file}`));
    hash.update(file).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return Object.freeze({ projectId: manifest.projectId, digest: hash.digest('hex'), files: Object.freeze(files) });
}

export async function assertOntologySnapshot(root: string, snapshot: OntologySnapshot): Promise<void> {
  const current = await createOntologySnapshot(root);
  if (snapshot.projectId !== current.projectId || snapshot.digest !== current.digest) {
    throw new Error('Retrato ontológico alterado; recarregue e valide o projeto antes de decidir');
  }
}
