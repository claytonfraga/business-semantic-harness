import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  carregarRegrasGovernanca,
  diagnosticarConfiguracaoGovernanca,
  GovernanceConfigError,
} from '../../dist/enforcement/governanca.js';
import { evaluateWorkspaceDiffGate } from '../../dist/enforcement/diffGate.js';
import { loadManifest } from '../../dist/project/manifest.js';

const run = promisify(execFile);

async function initRepoFixture({ domainEnforcementPath, enforcementContent } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-gov-config-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/alpha'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  const domainDef = {
    id: 'alpha',
    version: '1.0.0',
    baseIri: 'urn:alpha:',
    ontology: 'domains/alpha/ontology.jsonld',
    shapes: 'domains/alpha/shapes.ttl',
  };
  if (domainEnforcementPath) {
    domainDef.enforcement = domainEnforcementPath;
  }

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'gov-config-test',
      domains: [domainDef],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/alpha/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:alpha:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Item', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/alpha/shapes.ttl'),
    '@prefix ex: <urn:alpha:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\nex:Shape a sh:NodeShape ; sh:targetClass ex:Item .\n'
  );

  if (enforcementContent !== undefined) {
    const targetFile = domainEnforcementPath
      ? join(repo, '.bsh', domainEnforcementPath)
      : join(repo, '.bsh/domains/alpha/enforcement.json');
    await mkdir(join(targetFile, '..'), { recursive: true });
    await writeFile(targetFile, enforcementContent);
  }

  await run('git', ['init', '-b', 'main'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Tester'], { cwd: repo });
  await run('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
  await writeFile(join(repo, 'src/index.js'), '// initial\n');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-m', 'initial commit'], { cwd: repo });

  return { root, repo };
}

test('Given a valid governance configuration When loaded Then rules are returned correctly with domain attribution', async () => {
  const validConfig = JSON.stringify({
    schemaVersion: 1,
    regras: [
      {
        id: 'rule-alpha-1',
        operacao: 'AlphaOp',
        quando: { caminho: 'src/index.js', adicionou: 'test' },
        fatos: [{ propriedade: 'status', valor: 'ACTIVE', determinacao: 'observado', origem: 'code' }],
        evidenciasRequeridas: [{ tipo: 'estrutural', propriedade: 'status', obrigatoria: true }],
      },
    ],
  });

  const { root, repo } = await initRepoFixture({ enforcementContent: validConfig });
  try {
    const rules = await carregarRegrasGovernanca(repo);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, 'rule-alpha-1');
    assert.equal(rules[0].operacao, 'AlphaOp');
    assert.equal(rules[0].dominio, 'alpha');

    const diags = await diagnosticarConfiguracaoGovernanca(repo);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].status, 'VALID');
    assert.equal(diags[0].domainId, 'alpha');
    assert.equal(diags[0].regrasCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a custom enforcement path declared in manifest When loaded Then the custom path is used from project root', async () => {
  const validConfig = JSON.stringify({
    schemaVersion: 1,
    regras: [
      {
        id: 'rule-custom-1',
        operacao: 'CustomOp',
        quando: { caminho: 'src/index.js' },
      },
    ],
  });

  const customPath = 'custom/rules/my-enforcement.json';
  const { root, repo } = await initRepoFixture({
    domainEnforcementPath: customPath,
    enforcementContent: validConfig,
  });

  try {
    const manifest = await loadManifest(repo);
    assert.equal(manifest.domains[0].enforcement, customPath);

    const rules = await carregarRegrasGovernanca(repo);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].id, 'rule-custom-1');
    assert.equal(rules[0].dominio, 'alpha');

    const diags = await diagnosticarConfiguracaoGovernanca(repo);
    assert.equal(diags[0].status, 'VALID');
    assert.match(diags[0].path, /my-enforcement\.json/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a missing governance configuration file When evaluated Then distinct NOT_FOUND diagnostics are produced', async () => {
  const { root, repo } = await initRepoFixture({ enforcementContent: undefined });
  try {
    // When allowMissing is true (default), returns empty array
    const rules = await carregarRegrasGovernanca(repo, { allowMissing: true });
    assert.deepEqual(rules, []);

    // When allowMissing is false, throws GovernanceConfigError with code NOT_FOUND
    await assert.rejects(
      async () => {
        await carregarRegrasGovernanca(repo, { allowMissing: false });
      },
      (err) => {
        assert(err instanceof GovernanceConfigError);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.domainId, 'alpha');
        assert.match(err.message, /Arquivo de governança não encontrado/);
        return true;
      }
    );

    // Diagnostics report NOT_FOUND
    const diags = await diagnosticarConfiguracaoGovernanca(repo);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].status, 'NOT_FOUND');
    assert.equal(diags[0].domainId, 'alpha');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a malformed JSON governance configuration When loaded Then distinct INVALID error is thrown and not swallowed', async () => {
  const malformedJson = '{ "regras": [ { unclosed: ';
  const { root, repo } = await initRepoFixture({ enforcementContent: malformedJson });
  try {
    await assert.rejects(
      async () => {
        await carregarRegrasGovernanca(repo);
      },
      (err) => {
        assert(err instanceof GovernanceConfigError);
        assert.equal(err.code, 'INVALID');
        assert.equal(err.domainId, 'alpha');
        assert.match(err.message, /Arquivo de governança malformado/);
        return true;
      }
    );

    const diags = await diagnosticarConfiguracaoGovernanca(repo);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].status, 'INVALID');
    assert.equal(diags[0].domainId, 'alpha');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a governance file violating schema constraints When loaded Then distinct INVALID error identifies the invalid rule', async () => {
  const schemaInvalid = JSON.stringify({
    schemaVersion: 1,
    regras: [
      {
        id: 'valid-rule',
        operacao: 'Op1',
        quando: { caminho: 'src/index.js' },
      },
      {
        // Missing required 'operacao' and 'quando.caminho'
        id: 'broken-rule',
      },
    ],
  });

  const { root, repo } = await initRepoFixture({ enforcementContent: schemaInvalid });
  try {
    await assert.rejects(
      async () => {
        await carregarRegrasGovernanca(repo);
      },
      (err) => {
        assert(err instanceof GovernanceConfigError);
        assert.equal(err.code, 'INVALID');
        assert.equal(err.domainId, 'alpha');
        assert.match(err.message, /Regra inválida no índice 1/);
        return true;
      }
    );

    const diags = await diagnosticarConfiguracaoGovernanca(repo);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].status, 'INVALID');
    assert.match(diags[0].message, /Regra inválida no índice 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given an unreadable governance file When loaded Then distinct READ_ERROR is diagnosed', async () => {
  const validConfig = JSON.stringify({ schemaVersion: 1, regras: [] });
  const { root, repo } = await initRepoFixture({ enforcementContent: validConfig });
  const targetFile = join(repo, '.bsh/domains/alpha/enforcement.json');

  try {
    // Revoke read permissions (0o000)
    await chmod(targetFile, 0o000);

    // Skip assertion if running as root (where chmod 000 still allows reading)
    let canReadDespiteChmod = false;
    try {
      const { readFile } = await import('node:fs/promises');
      await readFile(targetFile, 'utf8');
      canReadDespiteChmod = true;
    } catch {
      canReadDespiteChmod = false;
    }

    if (!canReadDespiteChmod) {
      await assert.rejects(
        async () => {
          await carregarRegrasGovernanca(repo);
        },
        (err) => {
          assert(err instanceof GovernanceConfigError);
          assert.equal(err.code, 'READ_ERROR');
          assert.equal(err.domainId, 'alpha');
          assert.match(err.message, /Erro de leitura/);
          return true;
        }
      );

      const diags = await diagnosticarConfiguracaoGovernanca(repo);
      assert.equal(diags.length, 1);
      assert.equal(diags[0].status, 'READ_ERROR');
      assert.equal(diags[0].domainId, 'alpha');
    }
  } finally {
    // Restore permissions for cleanup
    await chmod(targetFile, 0o644).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a malformed governance configuration When evaluateWorkspaceDiffGate runs Then errors are not swallowed and VALIDATION_ERROR is returned', async () => {
  const malformedJson = '{ "regras": invalid json }';
  const { root, repo } = await initRepoFixture({ enforcementContent: malformedJson });

  try {
    // Make a change in the workspace
    await writeFile(join(repo, 'src/index.js'), '// modified code\n');

    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: repo,
      domainId: 'alpha',
      projectRoot: repo,
    });

    // Exception must not be swallowed into empty rules / fake CONFORMING
    assert.equal(gateResult.gateStatus, 'VALIDATION_ERROR');
    assert.equal(gateResult.semanticStatus, 'VALIDATION_ERROR');
    assert.equal(gateResult.conforming, false);
    assert(gateResult.violations.length > 0);
    assert.match(gateResult.violations[0], /Arquivo de governança malformado/);
    assert(gateResult.checks.some((c) => !c.ok && c.text.includes('Falha na configuração de governança')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
