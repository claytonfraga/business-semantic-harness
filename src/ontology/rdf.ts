import jsonld from 'jsonld';
import { Parser, Store } from 'n3';

export async function parseOntology(jsonText: string): Promise<Store> {
  let document: Parameters<typeof jsonld.toRDF>[0];
  try {
    document = JSON.parse(jsonText) as Parameters<typeof jsonld.toRDF>[0];
  } catch (error) {
    throw new Error('JSON-LD inválido: JSON malformado', { cause: error });
  }
  let rejectedContext: string | undefined;
  try {
    const nquads = await jsonld.toRDF(document, {
      format: 'application/n-quads',
      documentLoader: async (url: string): Promise<never> => {
        rejectedContext = url;
        throw new Error(`Contexto remoto não permitido: ${url}`);
      },
    });
    if (typeof nquads !== 'string') {
      throw new Error('Conversão RDF não retornou N-Quads');
    }
    return new Store(new Parser({ format: 'N-Quads' }).parse(nquads));
  } catch (error) {
    if (rejectedContext !== undefined) {
      throw new Error(`Contexto remoto não permitido: ${rejectedContext}`, { cause: error });
    }
    throw new Error('JSON-LD inválido: conversão RDF falhou', { cause: error });
  }
}

export function parseShapes(turtleText: string): Store {
  try {
    return new Store(new Parser({ format: 'Turtle' }).parse(turtleText));
  } catch (error) {
    throw new Error('Turtle inválido: shapes SHACL não puderam ser lidos', { cause: error });
  }
}
