import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';

test('Given an internal symlink pointing to an external control file (R4) When write_file is attempted Then it is blocked and external file remains unmodified', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const externalControl = join(externalDir, 'control.txt');
    const initialContent = 'CONTROL_PAYLOAD_UNMODIFIED';
    await writeFile(externalControl, initialContent, 'utf8');

    // Create an internal symlink pointing to the external file
    const symlinkPath = join(workspaceDir, 'control-link.txt');
    await symlink(externalControl, symlinkPath);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Attempt to write through the symlink
    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: 'control-link.txt',
          content: 'MALICIOUS_OVERWRITE',
        });
      },
      /Path escapes workspace/
    );

    // Verify external file is completely intact and unmodified
    const currentContent = await readFile(externalControl, 'utf8');
    assert.equal(currentContent, initialContent);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an internal symlink pointing to an external file When read_file or replace_file_content is attempted Then access is rejected and file is not modified', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const externalControl = join(externalDir, 'sensitive.txt');
    const initialContent = 'CONFIDENTIAL_DATA';
    await writeFile(externalControl, initialContent, 'utf8');

    const symlinkPath = join(workspaceDir, 'sensitive-link.txt');
    await symlink(externalControl, symlinkPath);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Attempt to read through symlink
    await assert.rejects(
      async () => {
        await executor.executeTool('read_file', { path: 'sensitive-link.txt' });
      },
      /Path escapes workspace/
    );

    // Attempt to replace content through symlink
    await assert.rejects(
      async () => {
        await executor.executeTool('replace_file_content', {
          path: 'sensitive-link.txt',
          target_content: 'CONFIDENTIAL',
          replacement_content: 'EXPOSED',
        });
      },
      /Path escapes workspace/
    );

    const currentContent = await readFile(externalControl, 'utf8');
    assert.equal(currentContent, initialContent);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an internal symlink pointing to an external directory When creating a new file inside it Then the operation is rejected before file creation', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const symlinkDir = join(workspaceDir, 'ext-dir-link');
    await symlink(externalDir, symlinkDir);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: 'ext-dir-link/new-file.txt',
          content: 'NEW_UNAUTHORIZED_FILE',
        });
      },
      /Path escapes workspace/
    );

    // Ensure file was not created in external directory
    await assert.rejects(
      async () => {
        await readFile(join(externalDir, 'new-file.txt'), 'utf8');
      },
      { code: 'ENOENT' }
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an internal symlink pointing to an external directory with nested non-existent path When write_file is attempted Then ancestor check rejects it', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const symlinkDir = join(workspaceDir, 'ext-tree-link');
    await symlink(externalDir, symlinkDir);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: 'ext-tree-link/nested/deep/file.txt',
          content: 'DEEP_ATTACK',
        });
      },
      /Path escapes workspace/
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an internal symlink pointing to an external directory When list_directory or search_code is attempted Then access is rejected', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    await writeFile(join(externalDir, 'secret.log'), 'SECRET_CONTENT', 'utf8');
    const symlinkDir = join(workspaceDir, 'ext-dir');
    await symlink(externalDir, symlinkDir);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    await assert.rejects(
      async () => {
        await executor.executeTool('list_directory', { path: 'ext-dir' });
      },
      /Path escapes workspace/
    );

    await assert.rejects(
      async () => {
        await executor.executeTool('search_code', {
          query: 'SECRET',
          path_prefix: 'ext-dir',
        });
      },
      /Path escapes workspace/
    );
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('Given an internal symlink pointing to an internal file or directory When accessed Then operations succeed inside workspace', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  try {
    await mkdir(join(workspaceDir, 'src'), { recursive: true });
    await writeFile(join(workspaceDir, 'src', 'real-file.txt'), 'ORIGINAL_INTERNAL_CONTENT', 'utf8');

    // Create valid internal symlink
    await symlink(join(workspaceDir, 'src', 'real-file.txt'), join(workspaceDir, 'src-link.txt'));

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Read through internal symlink
    const read = await executor.executeTool('read_file', { path: 'src-link.txt' });
    assert.equal(read, 'ORIGINAL_INTERNAL_CONTENT');

    // Write through internal symlink
    await executor.executeTool('write_file', {
      path: 'src-link.txt',
      content: 'UPDATED_INTERNAL_CONTENT',
    });

    const verifyContent = await readFile(join(workspaceDir, 'src', 'real-file.txt'), 'utf8');
    assert.equal(verifyContent, 'UPDATED_INTERNAL_CONTENT');
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('Given file descriptor inspection (TOCTOU mitigation) When writing with safeWriteFile Then external file is never truncated or overwritten', async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'bsh-ws-'));
  const externalDir = await mkdtemp(join(tmpdir(), 'bsh-ext-'));
  try {
    const externalControl = join(externalDir, 'toctou-control.txt');
    const originalContent = 'IMPORTANT_DATA_PRESERVED_SAFE_WRITE';
    await writeFile(externalControl, originalContent, 'utf8');

    const linkPath = join(workspaceDir, 'toctou-link.txt');
    await symlink(externalControl, linkPath);

    const executor = new WorkspaceToolExecutor(workspaceDir);

    // Call safeWriteFile directly via executeTool
    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: 'toctou-link.txt',
          content: 'SHOULD_NOT_TOUCH_EXTERNAL',
        });
      },
      /Path escapes workspace/
    );

    const postContent = await readFile(externalControl, 'utf8');
    assert.equal(postContent, originalContent);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});
