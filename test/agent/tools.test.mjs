import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceToolExecutor, AGENT_TOOLS } from '../../dist/agent/tools.js';

test('AGENT_TOOLS contains search_code and find_files', () => {
  const toolNames = AGENT_TOOLS.map((t) => t.function.name);
  assert.ok(toolNames.includes('search_code'), 'Deveria conter search_code');
  assert.ok(toolNames.includes('find_files'), 'Deveria conter find_files');
  assert.ok(toolNames.includes('read_file'), 'Deveria conter read_file');
  assert.ok(toolNames.includes('write_file'), 'Deveria conter write_file');
  assert.ok(toolNames.includes('replace_file_content'), 'Deveria conter replace_file_content');
  assert.ok(toolNames.includes('run_bash_command'), 'Deveria conter run_bash_command');
});

test('WorkspaceToolExecutor: search_code finds string occurrences with line numbers', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-tools-test-'));
  try {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'asset.ts'), 'export function transferAsset() {\n  return true;\n}\n');
    await writeFile(join(tempDir, 'src', 'other.ts'), 'export const active = false;\n');

    const executor = new WorkspaceToolExecutor(tempDir);
    const result = await executor.executeTool('search_code', { query: 'transferAsset' });
    assert.ok(result.includes('Found 1 matches'), 'Deveria encontrar 1 match');
    assert.ok(result.includes('src/asset.ts:1: export function transferAsset()'), 'Deveria incluir arquivo e linha');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('WorkspaceToolExecutor: find_files finds matching files by pattern', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-find-test-'));
  try {
    await mkdir(join(tempDir, 'src', 'governance'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'governance', 'shapes.ttl'), '# SHACL shapes\n');
    await writeFile(join(tempDir, 'src', 'index.ts'), '// root\n');

    const executor = new WorkspaceToolExecutor(tempDir);
    const result = await executor.executeTool('find_files', { pattern: 'shapes' });
    assert.ok(result.includes('Found 1 files'), 'Deveria encontrar 1 arquivo');
    assert.ok(result.includes('src/governance/shapes.ttl'), 'Deveria retornar caminho relativo');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('WorkspaceToolExecutor: write_file and replace_file_content modify workspace correctly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-edit-test-'));
  try {
    const executor = new WorkspaceToolExecutor(tempDir);
    await executor.executeTool('write_file', { path: 'hello.txt', content: 'Hello World' });
    const content1 = await executor.executeTool('read_file', { path: 'hello.txt' });
    assert.equal(content1, 'Hello World');

    await executor.executeTool('replace_file_content', {
      path: 'hello.txt',
      target_content: 'World',
      replacement_content: 'BSH Coding Agent',
    });
    const content2 = await executor.executeTool('read_file', { path: 'hello.txt' });
    assert.equal(content2, 'Hello BSH Coding Agent');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
