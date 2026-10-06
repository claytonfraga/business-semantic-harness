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
