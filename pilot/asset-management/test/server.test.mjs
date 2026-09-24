import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetServer, createAssetStore } from '../dist/server.js';

async function app() {
  const server = createAssetServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function post(base, path, value) {
  return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
}

test('Given seed assets, when the store is copied, then mutations do not change the seed', () => {
  const first = createAssetStore();
  first.get('A-100').responsible = 'alterado';
  assert.equal(createAssetStore().get('A-100').responsible, 'Ana');
});

test('Given the pilot server, when assets are listed, then available, in-use and retired examples are returned', async () => {
  const { server, base } = await app();
  try {
    const response = await fetch(base + '/assets');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map(item => item.status), ['EmUso', 'Disponivel', 'Baixado']);
  } finally { server.close(); }
});

test('Given an in-use asset, when a complete transfer is submitted, then responsible and location change', async () => {
  const { server, base } = await app();
  try {
    const response = await post(base, '/assets/A-100/transfer', { responsible: 'Daniel', location: 'Recife', justification: 'Mudança de equipe' });
    assert.equal(response.status, 200);
    const asset = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-100');
    assert.equal(asset.responsible, 'Daniel');
    assert.equal(asset.location, 'Recife');
  } finally { server.close(); }
});

test('Given a retired asset, when transfer is requested, then it is rejected without changing state', async () => {
  const { server, base } = await app();
  try {
    const before = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-300');
    const response = await post(base, '/assets/A-300/transfer', { responsible: 'Daniel', location: 'Recife', justification: 'Urgente' });
    assert.equal(response.status, 409);
    const after = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-300');
    assert.deepEqual(after, before);
  } finally { server.close(); }
});

test('Given an active asset, when retired and then transferred, then the later transfer is blocked', async () => {
  const { server, base } = await app();
  try {
    assert.equal((await post(base, '/assets/A-200/retire', { reason: 'Fim da vida útil' })).status, 200);
    assert.equal((await post(base, '/assets/A-200/transfer', { responsible: 'Daniel', location: 'Recife', justification: 'Teste' })).status, 409);
  } finally { server.close(); }
});

test('Given a transfer without justification, when submitted, then it is rejected without changing state', async () => {
  const { server, base } = await app();
  try {
    const response = await post(base, '/assets/A-100/transfer', { responsible: 'Daniel', location: 'Recife' });
    assert.equal(response.status, 400);
    const asset = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-100');
    assert.equal(asset.responsible, 'Ana');
  } finally { server.close(); }
});

test('Given an asset, when its responsible and location are updated, then both changes persist', async () => {
  const { server, base } = await app();
  try {
    assert.equal((await post(base, '/assets/A-200/responsible', { responsible: 'Elisa' })).status, 200);
    assert.equal((await post(base, '/assets/A-200/location', { location: 'Brasília' })).status, 200);
    const asset = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-200');
    assert.equal(asset.responsible, 'Elisa');
    assert.equal(asset.location, 'Brasília');
  } finally { server.close(); }
});

test('Given an active asset, when retirement has no reason, then it is rejected without changing state', async () => {
  const { server, base } = await app();
  try {
    const before = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-100');
    assert.equal((await post(base, '/assets/A-100/retire', {})).status, 400);
    const after = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-100');
    assert.deepEqual(after, before);
  } finally { server.close(); }
});

test('Given an active asset, when retirement has a reason, then the reason is retained and the status becomes retired', async () => {
  const { server, base } = await app();
  try {
    assert.equal((await post(base, '/assets/A-100/retire', { reason: 'Irrecuperável' })).status, 200);
    const after = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-100');
    assert.equal(after.status, 'Baixado');
    assert.equal(after.retirementReason, 'Irrecuperável');
  } finally { server.close(); }
});

test('Given a retired asset, when retirement, responsible and location mutations are attempted, then all are rejected without effects', async () => {
  const { server, base } = await app();
  try {
    const before = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-300');
    for (const [path, input] of [
      ['retire', { reason: 'Outra baixa' }],
      ['responsible', { responsible: 'Daniel' }],
      ['location', { location: 'Recife' }],
    ]) assert.equal((await post(base, `/assets/A-300/${path}`, input)).status, 409);
    const after = (await (await fetch(base + '/assets')).json()).find(item => item.id === 'A-300');
    assert.deepEqual(after, before);
  } finally { server.close(); }
});
