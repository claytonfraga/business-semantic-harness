import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../dist/cli.js';

test('Given BSH-CLI-004 a required CLI option When --prompt is provided without an argument Then the process returns exit code 2', async () => {
  const code = await main(['--prompt']);
  assert.equal(code, 2, 'Deveria retornar código 2 para --prompt sem argumento');
});

test('Given BSH-CLI-004 a required CLI option When --prompt-file is provided without an argument Then the process returns exit code 2', async () => {
  const code = await main(['--prompt-file']);
  assert.equal(code, 2, 'Deveria retornar código 2 para --prompt-file sem argumento');
});
