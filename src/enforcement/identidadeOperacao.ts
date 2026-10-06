import { loadManifest, type ProjectDomain } from '../project/manifest.js';
import { parseOntology } from '../ontology/rdf.js';
import { resolveProjectFile } from '../project/paths.js';
import { readFile } from 'node:fs/promises';
import { DataFactory } from 'n3';

/**
 * Single source of truth for operation identity resolution across preparation,
 * recognition and semantic validation. A local name is bound to the sovereign
 * baseIri of its declaring domain; an already-absolute IRI is preserved.
 */
export function ehIri(valor: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(valor);
}

export function resolverIdentidadeOperacao(nome: string, baseIri: string): string {
  return ehIri(nome) ? nome : `${baseIri}${nome}`;
}

/** Bind extraction to the operation owner, never manifesto order or a guessed base. */
export async function resolveOperationDomain(workspace: string, operation: { dominio: string; operacao: string; dependenciasDominio?: string[] }): Promise<{ domain: ProjectDomain; iri: string; domains: ProjectDomain[] }> {
  const manifest = await loadManifest(workspace);
  const owner = manifest.domains.find(domain => domain.id === operation.dominio);
  if (!owner) throw new Error(`OPERATION_DOMAIN_MISSING: operation '${operation.operacao}' has no declared owner '${operation.dominio}'.`);
  const candidates = new Map<string, ProjectDomain>();
  const visit = (domain: ProjectDomain): void => {
    if (candidates.has(domain.id)) return;
    candidates.set(domain.id, domain);
    for (const id of Object.keys(domain.dependencies ?? {})) {
      const dependency = manifest.domains.find(item => item.id === id);
      if (!dependency) throw new Error(`OPERATION_DEPENDENCY_MISSING: '${domain.id}' requires '${id}'.`);
      visit(dependency);
    }
  };
  visit(owner);
  for (const id of operation.dependenciasDominio ?? []) {
    if (!candidates.has(id)) throw new Error(`OPERATION_DEPENDENCY_UNDECLARED: '${id}' is outside '${owner.id}' declared closure.`);
  }
  const matches: Array<{ domain: ProjectDomain; iri: string }> = [];
  for (const domain of candidates.values()) {
    const iri = resolverIdentidadeOperacao(operation.operacao, domain.baseIri);
    const graph = await parseOntology(await readFile(await resolveProjectFile(workspace, `.bsh/${domain.ontology}`), 'utf8'));
    if (graph.countQuads(DataFactory.namedNode(iri), null, null, null) > 0) matches.push({ domain, iri });
  }
  // A local identity belongs to its explicit owner if declared there; dependencies
  // may supply a missing identity only when the result is unique.
  const direct = matches.find(match => match.domain.id === owner.id);
  if (direct && !ehIri(operation.operacao)) return { ...direct, domains: [...candidates.values()] };
  if (matches.length !== 1) throw new Error(`${matches.length ? 'OPERATION_IDENTITY_AMBIGUOUS' : 'OPERATION_IDENTITY_MISSING'}: '${operation.operacao}' in '${owner.id}' has ${matches.length} declared identities.`);
  return { ...matches[0], domains: [...candidates.values()] };
}
