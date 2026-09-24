import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transferir } from '../src/asset.js';

test('Given an available asset, when transferred, then the responsible is updated', () => {
  assert.equal(transferir({ status: 'Disponivel' }, 'Ana').responsible, 'Ana');
});

test('Given a retired asset, when transferred, then it fails', () => {
  assert.throws(() => transferir({ status: 'Baixado' }, 'Ana'));
});
