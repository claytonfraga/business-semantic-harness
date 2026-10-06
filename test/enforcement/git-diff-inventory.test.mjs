import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { lerDiff, aplicarRegras } from '../../dist/enforcement/extratorOperacoes.js';
import { evaluateWorkspaceDiffGate, getGitDiffNumstat } from '../../dist/enforcement/diffGate.js';

const run = promisify(execFile);

async function initRepoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-git-inventory-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/inv'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'git-inventory-test',
      domains: [
        {
          id: 'inv',
          version: '1.0.0',
          baseIri: 'urn:inv:',
          ontology: 'domains/inv/ontology.jsonld',
          shapes: 'domains/inv/shapes.ttl',
          enforcement: 'domains/inv/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/inv/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:inv:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Item', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/inv/shapes.ttl'),
    '@prefix ex: <urn:inv:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\nex:Shape a sh:NodeShape ; sh:targetClass ex:Item .\n'
  );

  await writeFile(
    join(repo, '.bsh/domains/inv/enforcement.json'),
    JSON.stringify({
      schemaVersion: 1,
      regras: [
        {
          id: 'rule-new-file',
          operacao: 'AddNewFileOp',
          quando: { caminho: 'src/new_file.txt', adicionou: 'BrandNewContent' },
          fatos: [{ propriedade: 'status', valor: 'NEW', determinacao: 'observado', origem: 'code' }],
        },
        {
          id: 'rule-delete-file',
          operacao: 'DeleteFileOp',
          quando: { caminho: 'src/to_delete.txt', arquivoRemovido: true },
          fatos: [{ propriedade: 'status', valor: 'DELETED', determinacao: 'observado', origem: 'code' }],
        },
        {
          id: 'rule-rename-file',
          operacao: 'RenameFileOp',
          quando: { caminho: 'src/renamed_target.txt' },
          fatos: [{ propriedade: 'status', valor: 'RENAMED', determinacao: 'observado', origem: 'code' }],
        },
      ],
    })
  );

  await run('git', ['init', '-b', 'main'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Tester'], { cwd: repo });
  await run('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
  await writeFile(join(repo, 'src/initial.txt'), 'initial line 1\ninitial line 2\n');
  await writeFile(join(repo, 'src/to_delete.txt'), 'line to delete 1\nline to delete 2\n');
  await writeFile(join(repo, 'src/to_rename.txt'), 'line to rename\n');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-m', 'initial commit'], { cwd: repo });

  return { root, repo };
}

test('Given an untracked new file When lerDiff and evaluateWorkspaceDiffGate inspect workspace Then R1 identifies new file as change with content', async () => {
  const { root, repo } = await initRepoFixture();
  try {
    // Create untracked file
    await writeFile(join(repo, 'src/new_file.txt'), 'BrandNewContent\nsecond line\n');

    // 1. lerDiff includes untracked file
    const diffs = await lerDiff(repo, 'HEAD');
    const newFileDiff = diffs.find((d) => d.caminho === 'src/new_file.txt');
    assert(newFileDiff, 'Untracked file must be included in diffs');
    assert.equal(newFileDiff.tipo, 'adicionado');
    assert.equal(newFileDiff.removido, false);
    assert.equal(newFileDiff.conteudoAtual, 'BrandNewContent\nsecond line\n');
    assert.equal(newFileDiff.conteudoAnterior, undefined);
    assert(newFileDiff.adicionadas.includes('BrandNewContent'));

    // 2. evaluateWorkspaceDiffGate identifies changes and recognizes operation
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      domainId: 'inv',
      projectRoot: repo,
    });
    assert.equal(gateResult.hasChanges, true);
    assert(gateResult.filesChanged.includes('src/new_file.txt'));
    assert(gateResult.operations.includes('AddNewFileOp'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a removed file When lerDiff and gate evaluate Then R2 represents deletion accurately with previous content', async () => {
  const { root, repo } = await initRepoFixture();
  try {
    // Delete file
    await unlink(join(repo, 'src/to_delete.txt'));

    // 1. lerDiff represents deletion
    const diffs = await lerDiff(repo, 'HEAD');
    const deletedDiff = diffs.find((d) => d.caminho === 'src/to_delete.txt');
    assert(deletedDiff, 'Deleted file must be found in diffs');
    assert.equal(deletedDiff.tipo, 'removido');
    assert.equal(deletedDiff.removido, true);
    assert.equal(deletedDiff.conteudoAtual, undefined);
    assert.equal(deletedDiff.conteudoAnterior, 'line to delete 1\nline to delete 2\n');
    assert.deepEqual(deletedDiff.adicionadas, []);
    assert(deletedDiff.removidas.includes('line to delete 1'));
    assert(deletedDiff.removidas.includes('line to delete 2'));

    // 2. Rules matching arquivoRemovido recognize the operation
    const regras = [
      {
        id: 'rule-del',
        dominio: 'inv',
        operacao: 'DeleteOp',
        quando: { caminho: 'src/to_delete.txt', arquivoRemovido: true },
        fatos: [],
      },
    ];
    const ops = aplicarRegras(regras, diffs);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].operacao, 'DeleteOp');

    // 3. evaluateWorkspaceDiffGate recognizes the operation
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      domainId: 'inv',
      projectRoot: repo,
    });
    assert.equal(gateResult.hasChanges, true);
    assert(gateResult.filesChanged.includes('src/to_delete.txt'));
    assert(gateResult.operations.includes('DeleteFileOp'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a renamed file When lerDiff runs Then both source and destination paths are preserved and related', async () => {
  const { root, repo } = await initRepoFixture();
  try {
    // Rename file using git mv
    await run('git', ['mv', 'src/to_rename.txt', 'src/renamed_target.txt'], { cwd: repo });

    const diffs = await lerDiff(repo, 'HEAD');
    const renameDiff = diffs.find((d) => d.caminho === 'src/renamed_target.txt');
    assert(renameDiff, 'Renamed target must be in diffs');
    assert.equal(renameDiff.tipo, 'renomeado');
    assert.equal(renameDiff.caminhoOrigem, 'src/to_rename.txt');
    assert.equal(renameDiff.removido, false);
    assert.equal(renameDiff.conteudoAnterior, 'line to rename\n');
    assert.equal(renameDiff.conteudoAtual, 'line to rename\n');

    // Applying rules preserves both paths in alteracoesRelacionadas
    const regras = [
      {
        id: 'rule-rename',
        dominio: 'inv',
        operacao: 'RenameOp',
        quando: { caminho: 'src/to_rename.txt' }, // targeting old path
        fatos: [],
      },
    ];
    const ops = aplicarRegras(regras, diffs);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].operacao, 'RenameOp');
    assert.deepEqual(ops[0].alteracoesRelacionadas, ['src/to_rename.txt', 'src/renamed_target.txt']);

    // Gate recognizes rename
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      domainId: 'inv',
      projectRoot: repo,
    });
    assert.equal(gateResult.hasChanges, true);
    assert(gateResult.filesChanged.includes('src/renamed_target.txt'));
    assert(gateResult.operations.includes('RenameFileOp'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given files with spaces, special characters, and newlines When inspected Then null-separated inventory preserves paths verbatim', async () => {
  const { root, repo } = await initRepoFixture();
  try {
    const spacePath = 'src/path with spaces/file with spaces.txt';
    const specialPath = 'src/relatório_ações_2026!@#.txt';
    const newlinePath = 'src/file\nwith\nnewline.txt';

    await mkdir(join(repo, 'src/path with spaces'), { recursive: true });
    await writeFile(join(repo, spacePath), 'content space\n');
    await writeFile(join(repo, specialPath), 'content special\n');
    await writeFile(join(repo, newlinePath), 'content newline\n');

    const diffs = await lerDiff(repo, 'HEAD');
    assert(diffs.some((d) => d.caminho === spacePath), 'File with spaces must be preserved');
    assert(diffs.some((d) => d.caminho === specialPath), 'File with special characters must be preserved');
    assert(diffs.some((d) => d.caminho === newlinePath), 'File with newlines must be preserved');

    const numstat = await getGitDiffNumstat(repo, 'HEAD');
    assert(numstat.files.some((f) => f.path === spacePath));
    assert(numstat.files.some((f) => f.path === specialPath));
    assert(numstat.files.some((f) => f.path === newlinePath));

    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      domainId: 'inv',
      projectRoot: repo,
    });
    assert.equal(gateResult.hasChanges, true);
    assert(gateResult.filesChanged.includes(spacePath));
    assert(gateResult.filesChanged.includes(specialPath));
    assert(gateResult.filesChanged.includes(newlinePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given an invalid git revision or git failure When evaluateWorkspaceDiffGate runs Then git error is NOT converted to empty diff', async () => {
  const { root, repo } = await initRepoFixture();
  try {
    // Non-existent base commit triggers Git failure
    const invalidCommit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    // 1. lerDiff rejects and does not swallow into empty array
    await assert.rejects(async () => {
      await lerDiff(repo, invalidCommit);
    });

    // 2. evaluateWorkspaceDiffGate returns VALIDATION_ERROR and non-conforming
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      commitBase: invalidCommit,
      domainId: 'inv',
      projectRoot: repo,
    });

    assert.equal(gateResult.conforming, false);
    assert.equal(gateResult.gateStatus, 'VALIDATION_ERROR');
    assert.equal(gateResult.semanticStatus, 'VALIDATION_ERROR');
    assert(gateResult.violations.length > 0);
    assert.match(gateResult.violations[0], /Erro Git/);
    assert(gateResult.checks.some((c) => !c.ok && c.text.includes('Erro Git')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
