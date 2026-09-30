import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DataFactory } from 'n3';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import { parseOntology, parseShapes } from '../ontology/rdf.js';
import { assertOntologySnapshot, type OntologySnapshot } from '../ontology/query.js';
import { validateData } from '../ontology/validate.js';
import { BSH_TERMS } from '../vocabulary/bsh.js';
import type { OperacaoSemantica, ResultadoEnforcement } from './operacaoSemantica.js';

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const RDFS_CLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#Class');
const OWL_CLASS = namedNode('http://www.w3.org/2002/07/owl#Class');
const SH_TARGET_CLASS = namedNode('http://www.w3.org/ns/shacl#targetClass');
const SH_PROPERTY = namedNode('http://www.w3.org/ns/shacl#property');
const SH_PATH = namedNode('http://www.w3.org/ns/shacl#path');
const SH_MESSAGE = namedNode('http://www.w3.org/ns/shacl#message');
const SH_MIN_COUNT = namedNode('http://www.w3.org/ns/shacl#minCount');

function shapePorMensagem(shapes: ReturnType<typeof parseShapes>, shapesAvaliados: string[], mensagem: string): string | undefined {
  for (const shape of shapesAvaliados) {
    for (const propriedade of shapes.getQuads(namedNode(shape), SH_PROPERTY, null, null)) {
      const mensagens = shapes.getQuads(propriedade.object, SH_MESSAGE, null, null).map((item) => item.object.value);
      if (mensagens.some((item) => mensagem.includes(item))) return shape;
    }
  }
  return shapesAvaliados[0];
}

function ehIri(valor: string): boolean {
  return valor.startsWith('http:') || valor.startsWith('https:') || valor.startsWith('urn:');
}

function termo(valor: string): string {
  return ehIri(valor) ? `<${valor}>` : `ex:${valor}`;
}

export async function validarOperacao(
  root: string,
  snapshot: OntologySnapshot,
  operacao: OperacaoSemantica,
): Promise<ResultadoEnforcement> {
  const resultado: ResultadoEnforcement = {
    status: 'indeterminado', dominio: operacao.dominio, operacao: operacao.operacao, governado: false,
    requerRevisaoHumana: false, evidencia: [], shapesAvaliados: [], selectedShapes: [], executedShapes: [],
    validationExecuted: false, validationComplete: false, missingFacts: [],
    politicas: [], proveniencia: operacao.proveniencia,
  };
  try {
    await assertOntologySnapshot(root, snapshot);
  } catch (error) {
    resultado.evidencia.push(error instanceof Error ? error.message : String(error));
    return resultado;
  }
  const manifest = await loadManifest(root);
  const dominio = manifest.domains.find((item) => item.id === operacao.dominio);
  if (!dominio) {
    resultado.evidencia.push(`Dominio nao declarado: ${operacao.dominio}`);
    return resultado;
  }
  const base = dominio.baseIri;
  const classe = ehIri(operacao.operacao) ? operacao.operacao : `${base}${operacao.operacao}`;
  const ontology = await parseOntology(await readFile(await resolveProjectFile(root, `.bsh/${dominio.ontology}`), 'utf8'));
  const shapes = parseShapes(await readFile(await resolveProjectFile(root, `.bsh/${dominio.shapes}`), 'utf8'));

  const declarada = ontology.getQuads(namedNode(classe), RDF_TYPE, RDFS_CLASS, null).length
    + ontology.getQuads(namedNode(classe), RDF_TYPE, OWL_CLASS, null).length;
  const shapesAplicaveis = shapes.getQuads(null, SH_TARGET_CLASS, namedNode(classe), null);
  const politicasHumanas = ontology.getQuads(null, RDF_TYPE, namedNode(BSH_TERMS.Policy), null)
    .filter((q) => ontology.getQuads(q.subject, namedNode(BSH_TERMS.governs), namedNode(classe), null).length > 0)
    .filter((q) => ontology.getQuads(q.subject, namedNode(BSH_TERMS.requiresHumanReview), null, null).some((review) => review.object.value === 'true'));

  if (declarada === 0 && shapesAplicaveis.length === 0 && politicasHumanas.length === 0) {
    resultado.status = 'conforme';
    resultado.evidencia.push('Sem conhecimento governado aplicavel; a alteracao segue o fluxo normal');
    return resultado;
  }
  resultado.governado = true;
  resultado.shapesAvaliados = shapesAplicaveis.map((q) => q.subject.value);
  resultado.selectedShapes = resultado.shapesAvaliados;
  resultado.politicas = politicasHumanas.map((q) => q.subject.value);

  const caminhosObrigatorios = new Set<string>();
  for (const shape of shapesAplicaveis) {
    for (const propriedade of shapes.getQuads(shape.subject, SH_PROPERTY, null, null)) {
      const caminho = shapes.getQuads(propriedade.object, SH_PATH, null, null)[0];
      // Só caminhos com sh:minCount >= 1 são obrigatórios para completude do candidato;
      // constraints como sh:disjoint não exigem presença.
      const obrigatorio = shapes.getQuads(propriedade.object, SH_MIN_COUNT, null, null)
        .some((q) => Number(q.object.value) >= 1);
      if (caminho && obrigatorio) caminhosObrigatorios.add(caminho.object.value);
    }
  }
  const indeterminadosObrigatorios = operacao.fatos.filter((fato) => fato.determinacao === 'indeterminado'
    && (caminhosObrigatorios.has(fato.propriedade) || caminhosObrigatorios.has(`${base}${fato.propriedade}`)));
  if (indeterminadosObrigatorios.length > 0) {
    resultado.status = 'indeterminado';
    resultado.evidencia.push(`Fato obrigatorio indeterminado: ${indeterminadosObrigatorios.map((fato) => fato.propriedade).join(', ')}`);
    return resultado;
  }

  const individuos = new Set(ontology.getQuads(null, null, null, null)
    .filter((q) => q.subject.termType === 'NamedNode').map((q) => q.subject.value));
  const linhas = [`@prefix ex: <${base}> .`, `ex:operacao a ${termo(operacao.operacao)} .`];
  for (const fato of operacao.fatos) {
    if (fato.determinacao === 'indeterminado' || fato.valor === null) continue;
    const valor = individuos.has(`${base}${fato.valor}`) ? `ex:${fato.valor}` : JSON.stringify(fato.valor);
    linhas.push(`ex:operacao ex:${fato.propriedade} ${valor} .`);
  }
  const candidateTurtle = operacao.candidateGraphTurtle;
  const fatos = parseShapes(candidateTurtle ?? linhas.join('\n'));
  resultado.candidateGraphHash = createHash('sha256').update(candidateTurtle ?? linhas.join('\n')).digest('hex');

  if (candidateTurtle !== undefined) {
    const focus = fatos.getQuads(null, RDF_TYPE, namedNode(classe), null).map((q) => q.subject);
    if (focus.length === 0) {
      resultado.evidencia.push('Estado candidato sem foco tipado para a operação reconhecida');
      return resultado;
    }
    const missing = [...caminhosObrigatorios].filter((path) => focus.some((node) =>
      fatos.countQuads(node, namedNode(path), null, null) === 0));
    resultado.missingFacts = missing;
    if (missing.length > 0) {
      resultado.evidencia.push(`Fatos do estado candidato ausentes: ${missing.join(', ')}`);
      return resultado;
    }
  }

  if (shapesAplicaveis.length > 0) {
    resultado.validationExecuted = true;
    const validacao = await validateData(shapes, fatos);
    resultado.validationResults = validacao.results;
    if (validacao.conforms !== true && validacao.conforms !== false) {
      resultado.evidencia.push('Validador retornou estado sem conformidade explícita');
      return resultado;
    }
    resultado.executedShapes = [...resultado.selectedShapes];
    resultado.validationComplete = true;
    if (!validacao.conforms || validacao.results.length > 0) {
      resultado.status = 'violacao';
      const mensagem = validacao.results[0]?.message || 'Violacao SHACL';
      resultado.regra = mensagem;
      resultado.shape = shapePorMensagem(shapes, resultado.shapesAvaliados, mensagem) ?? resultado.shapesAvaliados[0];
      resultado.evidencia.push(...validacao.results.map((item) => item.message || `Violacao em ${item.focusNode}`));
      return resultado;
    }
  }
  if (politicasHumanas.length > 0) {
    resultado.status = 'revisao_humana';
    resultado.requerRevisaoHumana = true;
    resultado.regra = 'Politica aplicavel exige revisao humana';
    resultado.evidencia.push(`Politicas: ${resultado.politicas.join(', ')}`);
    return resultado;
  }
  resultado.status = 'conforme';
  resultado.evidencia.push('Operacao conforme as restricoes aplicaveis');
  return resultado;
}
