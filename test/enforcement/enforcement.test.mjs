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

test('Given BSH-SEM-002 a Disponivel asset When validating AlteracaoResponsavel with required fields Then status is conforme', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AlteracaoResponsavel', [['estadoAtual', 'Disponivel'], ['novoResponsavel', 'Resp']]));
  assert.equal(resultado.status, 'conforme');
});

test('Given BSH-SEM-003 a Baixado asset When validating TransferenciaAtivo Then status is violacao matching TransferenciaShape', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /TransferenciaShape/);
});

test('Given BSH-SEM-003 a Baixado asset When validating AlteracaoResponsavel Then status is violacao matching ResponsavelShape', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AlteracaoResponsavel', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /ResponsavelShape/);
});

test('Given BSH-SEM-003 a Baixado asset When validating AtualizacaoLocalizacao Then status is violacao matching LocalizacaoShape', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('AtualizacaoLocalizacao', [['estadoAtual', 'Baixado'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'violacao');
  assert.match(resultado.shape ?? '', /LocalizacaoShape/);
});

test('Given BSH-SEM-003 an operation subject to human-review policy When validating TransferenciaAtivo Then status is revisao_humana', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Disponivel'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'revisao_humana');
  assert.equal(resultado.requerRevisaoHumana, true);
});

test('Given BSH-SEM-002 a governed operation with an undetermined required fact When validating TransferenciaAtivo Then status is indeterminado', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('TransferenciaAtivo', [['estadoAtual', 'Disponivel'], ['novoResponsavel', null, 'indeterminado'], ['novaLocalizacao', 'Almoxarifado']]));
  assert.equal(resultado.status, 'indeterminado');
});

test('Given BSH-EXTRACT-DOMAIN-001 an operation identity absent from its contract When validating Then indetermination prevents an unsupported conformity claim', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const resultado = await validarOperacao(raiz, snapshot, operacao('OperacaoNaoGovernada', []));
  assert.equal(resultado.status, 'indeterminado');
  assert.match(resultado.evidencia.join(' '), /OPERATION_IDENTITY_MISSING/);
});

test('Given BSH-SEM-004 a governed violation with no conflict report When avaliarOperacoes evaluates batch Then status is violacao and bloquear is true', async () => {
  const snapshot = await createOntologySnapshot(raiz);
  const lote = await avaliarOperacoes(raiz, snapshot, [
    operacao('TransferenciaAtivo', [['estadoAtual', 'Baixado'], ['novoResponsavel', 'Resp'], ['novaLocalizacao', 'Almoxarifado']]),
  ]);
  assert.equal(lote.status, 'violacao');
  assert.equal(lote.bloquear, true);
});
