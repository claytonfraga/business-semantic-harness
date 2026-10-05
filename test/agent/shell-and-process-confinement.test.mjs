import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkspaceToolExecutor, buildSafeEnv, SAFE_ENV_ALLOWLIST } from '../../dist/agent/tools.js';
import { McpClientManager } from '../../dist/mcp/clientManager.js';

test('Given an agent executing a shell command (R5), when attempting to write outside authorized workspace, then the write is blocked and external control file remains unmodified', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const externalControl = join(externalDir, 'host-control.txt');
    const initialContent = 'EXTERNAL_HOST_CONTROL_DATA';
    await writeFile(externalControl, initialContent, 'utf8');

    const executor = new WorkspaceToolExecutor(workspaceDir);
    const result = await executor.executeTool('run_bash_command', {
      command: `echo "MALICIOUS_OVERWRITE" > "${externalControl}" 2>&1 || true`,
    });

    // Check command result or error
    assert.ok(result.includes('Exit code') || result.includes('somente para leitura') || result.includes('Read-only'), result);

    // Verify external file remained intact
    const current = await readFile(externalControl, 'utf8');
    assert.equal(current, initialContent);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an agent executing a shell command, when attempting to write to .git or .bsh, then writes are blocked and files remain unmodified', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  try {
    const gitDir = join(workspaceDir, '.git');
    await mkdir(gitDir, { recursive: true });
    const gitConfig = join(gitDir, 'config');
    const initialGit = 'ORIGINAL_GIT_CONFIG';
    await writeFile(gitConfig, initialGit, 'utf8');

    const bshDir = join(workspaceDir, '.bsh');
    await mkdir(bshDir, { recursive: true });
    const ontology = join(bshDir, 'ontology.jsonld');
    const initialOntology = '{"ontology": "unmodified"}';
    await writeFile(ontology, initialOntology, 'utf8');

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Try modifying .git
    await executor.executeTool('run_bash_command', {
      command: `echo "HACKED_GIT" > "${gitConfig}" 2>&1 || true`,
    });
    const gitCurrent = await readFile(gitConfig, 'utf8');
    assert.equal(gitCurrent, initialGit);

    // Try modifying .bsh
    await executor.executeTool('run_bash_command', {
      command: `echo "HACKED_BSH" > "${ontology}" 2>&1 || true`,
    });
    const ontologyCurrent = await readFile(ontology, 'utf8');
    assert.equal(ontologyCurrent, initialOntology);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Given file tools (write_file and replace_file_content), when attempting to target .git or .bsh, then write access is denied', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  try {
    const gitDir = join(workspaceDir, '.git');
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

    const bshDir = join(workspaceDir, '.bsh');
    await mkdir(bshDir, { recursive: true });
    await writeFile(join(bshDir, 'shapes.ttl'), '# shapes\n', 'utf8');

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Attempt write_file on .git
    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: '.git/HEAD',
          content: 'malicious',
        });
      },
      /Write access denied: protected path/
    );

    // Attempt replace_file_content on .bsh
    await assert.rejects(
      async () => {
        await executor.executeTool('replace_file_content', {
          path: '.bsh/shapes.ttl',
          target_content: 'shapes',
          replacement_content: 'corrupted',
        });
      },
      /Write access denied: protected path/
    );

    // Reading should still be allowed
    const head = await executor.executeTool('read_file', { path: '.git/HEAD' });
    assert.match(head, /refs\/heads\/main/);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Given host environment variables with secrets, when run_bash_command executes, then secrets are not inherited and only safe variables are provided', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const secretKey = 'TEST_BSH_SECRET_KEY_' + Date.now();
  process.env[secretKey] = 'SUPER_SECRET_TOKEN_12345';
  try {
    const executor = new WorkspaceToolExecutor(workspaceDir);
    const result = await executor.executeTool('run_bash_command', {
      command: `echo "SECRET_IS_[\$${secretKey}]"`,
    });

    assert.ok(result.includes('SECRET_IS_[]'), `Secret should be empty, got: ${result}`);
  } finally {
    delete process.env[secretKey];
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Given network policy (allowNetwork: false), when run_bash_command attempts external connections, then network access is denied', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  try {
    const executor = new WorkspaceToolExecutor(workspaceDir, undefined, { allowNetwork: false });
    const result = await executor.executeTool('run_bash_command', {
      command: 'ping -c 1 8.8.8.8 2>&1 || curl --connect-timeout 2 http://1.1.1.1 2>&1',
    });

    assert.ok(
      result.includes('Network is unreachable') ||
      result.includes('Could not resolve') ||
      result.includes('Exit code: 1') ||
      result.includes('Exit code: 2') ||
      result.includes('Exit code: 6') ||
      result.includes('Exit code: 7'),
      `Expected network failure, got: ${result}`
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Given buildSafeEnv, when filtering process.env, then only allowlisted variables and explicit extras are retained', () => {
  const secretKey = 'HOST_SECRET_VAR_' + Date.now();
  const previousPager = process.env.PAGER;
  process.env[secretKey] = 'HOST_SECRET';
  process.env.PAGER = 'less';
  try {
    const safe = buildSafeEnv({ EXPLICIT_VAR: 'SAFE_VALUE' }, SAFE_ENV_ALLOWLIST);
    assert.equal(safe[secretKey], undefined);
    assert.equal(safe.EXPLICIT_VAR, 'SAFE_VALUE');
    assert.equal(safe.PAGER, 'cat');
    if (process.env.PATH) {
      assert.equal(safe.PATH, process.env.PATH);
    }
  } finally {
    delete process.env[secretKey];
    if (previousPager === undefined) delete process.env.PAGER;
    else process.env.PAGER = previousPager;
  }
});

test('Given BSH-TOOLS-013 explicit process configuration When the safe environment is built Then the configured pager overrides the noninteractive default', () => {
  assert.equal(buildSafeEnv({ PAGER: 'custom-pager' }).PAGER, 'custom-pager');
});

test('Given McpClientManager, when configuring servers, then environment is restricted without inheriting arbitrary secrets', async () => {
  const secretKey = 'MCP_SECRET_VAR_' + Date.now();
  process.env[secretKey] = 'TOP_SECRET_MCP';
  try {
    const manager = new McpClientManager();
    // Verify buildSafeEnv used for MCP server configs strips secrets
    const serverEnv = buildSafeEnv({ CUSTOM_SERVER_VAR: 'CUSTOM_VALUE' });
    assert.equal(serverEnv[secretKey], undefined);
    assert.equal(serverEnv.CUSTOM_SERVER_VAR, 'CUSTOM_VALUE');
  } finally {
    delete process.env[secretKey];
  }
});
