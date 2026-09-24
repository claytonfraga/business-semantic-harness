import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { validarOperacao } from '../../dist/enforcement/validadorSemantico.js';
import { avaliarOperacoes } from '../../dist/enforcement/motorEnforcement.js';

const raiz = resolve('pilot/asset-management');

function operacao(nome, fatos) {
  return {
    id: nome,
    dominio: 'ativos',
    operacao: nome,
    fatos: fatos.map(([propriedade, valor, determinacao = 'observado']) => ({ propriedade, valor, determinacao, origem: 'teste' })),
    proveniencia: { origem: 'teste', descricao: 'operacao de teste' },
    alteracoesRelacionadas: ['src/server.ts'],
  };
}

test('Caso A: Given a Disponivel asset changed with the required fields, then it is conforme', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AlteracaoResponsavel', [['estadoAtual', 'Disponivel'], ['novoResponsavel', 'Resp']]));
  assert.equal(resultado.status, 'conforme');
});

test('Caso B: Given a Baixado asset transferred, then TransferenciaShape is a violation', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /TransferenciaShape/);
});

test('Caso C: Given a Baixado asset with a responsible change, then ResponsavelShape is a violation', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AlteracaoResponsavel', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /ResponsavelShape/);
});

test('Caso D: Given a Baixado asset with a location change, then LocalizacaoShape is a violation', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AtualizacaoLocalizacao', [['estadoAtual', 'Baixado'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /LocalizacaoShape/);
});

test('Caso E: Given an operation subject to a human-review policy, then it is revisao_humana', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Disponivel'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'revisao_humana');
  assert.equal(resultado.requerRevisaoHumana, true);
});

test('Caso F: Given a governed operation with an undetermined required fact, then it is indeterminado', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Disponivel'], ['novoResponsavel', null, 'indeterminado'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'indeterminado');
});

test('Caso G: Given an operation with no governed knowledge, then it does not invent a violation', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('OperacaoNaoGovernada', []));
  assert.equal(resultado.status, 'conforme');
  assert.equal(resultado.governado, false);
});

test('Caso H: Given a governed violation and no conflict report, then the independent enforcement still blocks', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const lote = await avaliarOperacoes(raiz, snapshot, [
    operacao('TransferenciaAtivo', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]),
  ]);
  assert.equal(lote.status, 'violacao');
  assert.equal(lote.bloquear, true);
});
