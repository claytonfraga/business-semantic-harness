import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transferir, darBaixa, alterarResponsavel, alterarLocalizacao } from '../src/asset.js';

test('transferir valido', () => { assert.equal(transferir({ status: 'Disponivel' }, 'Ana').responsible, 'Ana'); });
test('transferir baixado falha', () => { assert.throws(() => transferir({ status: 'Baixado' }, 'Ana')); });
test('baixa exige motivo', () => { assert.throws(() => darBaixa({ status: 'EmUso' }, '')); });
test('alterarResponsavel baixado falha', () => { assert.throws(() => alterarResponsavel({ status: 'Baixado' }, 'Ana')); });
test('alterarLocalizacao baixado falha', () => { assert.throws(() => alterarLocalizacao({ status: 'Baixado' }, 'Recife')); });
