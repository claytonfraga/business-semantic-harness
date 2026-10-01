import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../dist/cli.js';

test('CLI: --prompt flag without argument returns code 2', async () => {
  const code = await main(['--prompt']);
  assert.equal(code, 2, 'Deveria retornar código 2 para --prompt sem argumento');
});

test('CLI: --prompt-file flag without argument returns code 2', async () => {
  const code = await main(['--prompt-file']);
  assert.equal(code, 2, 'Deveria retornar código 2 para --prompt-file sem argumento');
});
