import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateProject } from '../../ontology/validate.js';
import { createIsolatedCodex, verifyReadOnlyMount, verifyWorkspaceMount } from './isolation.js';

const execFileAsync = promisify(execFile);

export interface DoctorReport {
  ready: boolean;
  codexVersion?: string;
  ontologyReady: boolean;
  mcpEntrypointReady: boolean;
  isolationVerified: boolean;
  reasons: string[];
}

export interface RuntimeReport {
  ready: boolean;
  codexVersion?: string;
  reasons: string[];
}

export async function diagnoseCodexRuntime(root: string): Promise<RuntimeReport> {
  const reasons: string[] = [];
  let codexVersion: string | undefined;
  try {
    const result = await execFileAsync('codex', ['--version'], { timeout: 5_000 });
    codexVersion = result.stdout.trim();
    if (codexVersion !== 'codex-cli 0.156.1') reasons.push(`Versão Codex não verificada: ${codexVersion}`);
  } catch {
    reasons.push('Codex CLI indisponível');
  }
  const ontology = await validateProject(root);
  if (!ontology.ready) reasons.push(...ontology.issues.map((issue) => `${issue.domain}: ${issue.message}`));
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
  } catch {
    reasons.push('Servidor MCP Oracle não compilado');
  }
  return { ready: reasons.length === 0, codexVersion, reasons };
}

export async function diagnoseCodex(root: string): Promise<DoctorReport> {
  const reasons: string[] = [];
  let codexVersion: string | undefined;
  try {
    const result = await execFileAsync('codex', ['--version'], { timeout: 5_000 });
    codexVersion = result.stdout.trim();
    if (codexVersion !== 'codex-cli 0.156.1') reasons.push(`Versão Codex não verificada: ${codexVersion}`);
  } catch {
    reasons.push('Codex CLI indisponível');
  }
  const ontology = await validateProject(root);
  if (!ontology.ready) reasons.push(...ontology.issues.map((issue) => `${issue.domain}: ${issue.message}`));
  let mcpEntrypointReady = false;
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
    mcpEntrypointReady = true;
  } catch {
    reasons.push('Servidor MCP Oracle não compilado');
  }
  let isolationVerified = false;
  if (reasons.length === 0) {
    try {
      await verifyReadOnlyMount();
      const isolated = await createIsolatedCodex(root, true);
      try {
        const { client, workspace } = isolated;
        await verifyWorkspaceMount(root, workspace);
        await client.initialize();
        await client.verifyCleanConfiguration(workspace);
        const threadId = await client.startWorkspaceThread(workspace);
        await client.verifyOracleMcp(threadId);
        isolationVerified = true;
      } finally {
        await isolated.dispose();
      }
    } catch (error) {
      reasons.push(`Fronteira de mutação não comprovada: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ready: reasons.length === 0 && isolationVerified,
    codexVersion,
    ontologyReady: ontology.ready,
    mcpEntrypointReady,
    isolationVerified,
    reasons,
  };
}
