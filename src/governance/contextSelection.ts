import type { QueryTriple } from '../ontology/query.js';

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** Operational sufficiency, not inference or candidate conformance. */
export function assessContextSelection(graph: QueryTriple[], selected: Set<string>, recovered: QueryTriple[], ontology: QueryTriple[]) {
  const reasons: string[] = [];
  if (selected.size === 0) reasons.push('No pertinent correspondence establishes selection roots.');
  if (graph.some(t => ['targetNode', 'targetSubjectsOf', 'targetObjectsOf', 'target', 'sparql'].includes(t.predicate.slice(SH.length)) && t.predicate.startsWith(SH))) {
    reasons.push('Non-class targets or SHACL-SPARQL require integral source context.');
  }
  if (ontology.some(t => ['http://www.w3.org/2000/01/rdf-schema#subClassOf', 'http://www.w3.org/2002/07/owl#equivalentClass', 'http://www.w3.org/2002/07/owl#imports'].includes(t.predicate))) {
    reasons.push('Hierarchy or ontology imports exceed direct correspondence selection.');
  }
  const subjects = new Set(graph.map(t => `${t.subject.type}:${t.subject.value}`));
  const statements = new Map<string, QueryTriple[]>();
  for (const triple of graph) {
    const key = `${triple.subject.type}:${triple.subject.value}`;
    const values = statements.get(key) ?? [];
    values.push(triple);
    statements.set(key, values);
  }
  const referencePredicates = new Set(['node', 'property', 'qualifiedValueShape', 'not', 'and', 'or', 'xone', 'alternativePath', 'path', 'inversePath', 'zeroOrMorePath', 'oneOrMorePath', 'zeroOrOnePath', 'in', 'languageIn', 'ignoredProperties'].map(p => SH + p));
  const inspected = reasons.length ? graph : recovered;
  for (const triple of inspected) {
    const required = triple.object.type === 'BlankNode' || (referencePredicates.has(triple.predicate) && ![`${SH}path`, `${SH}inversePath`, `${SH}zeroOrMorePath`, `${SH}oneOrMorePath`, `${SH}zeroOrOnePath`].includes(triple.predicate));
    if (required && triple.object.type !== 'Literal' && triple.object.value !== `${RDF}nil` && !subjects.has(`${triple.object.type}:${triple.object.value}`)) {
      throw new Error(`Required constraint reference is unavailable: ${triple.predicate} -> ${triple.object.value}. Repair the shape or declare its owning dependency.`);
    }
    if (triple.predicate === `${RDF}first` || triple.predicate === `${RDF}rest`) {
      for (const predicate of [`${RDF}first`, `${RDF}rest`]) {
        const count = (statements.get(`${triple.subject.type}:${triple.subject.value}`) ?? []).filter(t => t.predicate === predicate).length;
        if (count !== 1) throw new Error(`Incomplete RDF list at ${triple.subject.value}: expected one ${predicate}. Repair the contract before dispatch.`);
      }
    }
  }
  return { mode: reasons.length ? 'INTEGRAL_DOCUMENTS' as const : 'RELEVANT_CLOSURE' as const, reasons,
    criteria: ['Established correspondence roots', 'Direct class targets without SPARQL or hierarchy-dependent selection', 'Resolved structural references and complete RDF list cells across declared dependencies'] };
}
