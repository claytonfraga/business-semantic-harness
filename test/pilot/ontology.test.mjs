import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { validateData } from '../../dist/ontology/validate.js';

const pilot = new URL('../../pilot/asset-management/', import.meta.url);
async function graph(path) { return parseShapes(await readFile(new URL(path, pilot), 'utf8')); }
const ex = '@prefix ex: <urn:bsh:pilot:ativos:> .\n';
async function check(facts) { return validateData(await graph('.bsh/domains/ativos/shapes.ttl'), parseShapes(ex + facts)); }

test('Given the pilot transfer shape, when a valid transfer graph is checked, then it conforms', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-valid.ttl'));
  assert.equal(report.conforms, true);
});

test('Given a retired asset, when its transfer graph is checked, then SHACL rejects its state', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-retired.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('baixado')));
});

test('Given no new responsible, when a transfer graph is checked, then SHACL reports the missing fact', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-no-responsible.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given no new location, when a transfer graph is checked, then SHACL reports the missing location', async () => {
  const report = await check('ex:a a ex:TransferenciaAtivo; ex:estadoAtual ex:EmUso; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});

test('Given an active asset and a retirement reason, when its retirement graph is checked, then SHACL conforms', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso; ex:motivoBaixa "Irrecuperável" .');
  assert.equal(report.conforms, true);
});

test('Given no retirement reason, when a retirement graph is checked, then SHACL reports the missing reason', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('motivo')));
});

test('Given a retired asset, when another retirement graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:Baixado; ex:motivoBaixa "Outra" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('nova baixa')));
});

test('Given a retired asset, when a responsible change graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AlteracaoResponsavel; ex:estadoAtual ex:Baixado; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given a retired asset, when a location change graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AtualizacaoLocalizacao; ex:estadoAtual ex:Baixado; ex:novaLocalizacao "Recife" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});
