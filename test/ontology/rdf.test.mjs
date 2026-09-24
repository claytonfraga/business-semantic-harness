import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DataFactory } from 'n3';
import { parseOntology, parseShapes } from '../../dist/ontology/rdf.js';

const { namedNode } = DataFactory;
const fixture = new URL('../fixtures/ativos/', import.meta.url);

test('Given a domain JSON-LD graph, when parsed, then classes and policy relations are preserved', async () => {
  const text = await readFile(new URL('ontology.jsonld', fixture), 'utf8');
  const store = await parseOntology(text);
  assert.equal(store.getQuads(namedNode('urn:pilot:ativos:Ativo'), namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2000/01/rdf-schema#Class'), null).length, 1);
  assert.equal(store.getQuads(namedNode('urn:pilot:ativos:justificativa-adequada'), namedNode('urn:oracle:ns:v1:governs'), namedNode('urn:pilot:ativos:TransferenciaAtivo'), null).length, 1);
});

test('Given a Turtle shape, when parsed, then its transfer target is preserved', async () => {
  const text = await readFile(new URL('shapes.ttl', fixture), 'utf8');
  const store = parseShapes(text);
  assert.equal(store.getQuads(namedNode('urn:pilot:ativos:TransferenciaShape'), namedNode('http://www.w3.org/ns/shacl#targetClass'), namedNode('urn:pilot:ativos:TransferenciaAtivo'), null).length, 1);
});

test('Given a remote JSON-LD context, when parsed, then it is rejected before network access', async () => {
  await assert.rejects(parseOntology(JSON.stringify({ '@context': 'https://invalid.example/remote-context', '@id': 'urn:example:Ativo' })), /Contexto remoto não permitido/);
});

test('Given malformed Turtle, when parsed, then an explicit error is returned', () => {
  assert.throws(() => parseShapes('@prefix ex: <urn:pilot:ativos:> . ex:Broken <'), /Turtle inválido/);
});
