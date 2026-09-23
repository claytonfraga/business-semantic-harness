import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateProject } from '../../ontology/validate.js';

const execFileAsync = promisify(execFile);

export interface DoctorReport {
  ready: boolean;
  codexVersion?: string;
  ontologyReady: boolean;
  mcpEntrypointReady: boolean;
  isolationVerified: boolean;
  reasons: string[];
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
  reasons.push('Fronteira de mutação do Codex ainda não verificada; sessão governada desabilitada');
  return {
    ready: false,
    codexVersion,
    ontologyReady: ontology.ready,
    mcpEntrypointReady,
    isolationVerified: false,
    reasons,
  };
}
