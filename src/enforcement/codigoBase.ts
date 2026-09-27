import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Universo canônico do "código-base experimental": diretórios derivados/temporários ficam fora.
 * Esta definição é espelhada do benchmark (benchmark/core/codebase_change.py) e precisa permanecer idêntica.
 */
const IGNORAR = new Set(['.git', 'node_modules', 'dist', 'coverage', '__pycache__', '.venv']);

function relevante(rel: string): boolean {
  if (rel === '.bsh/local' || rel.startsWith('.bsh/local/')) return false;
  return !IGNORAR.has(rel.split('/')[0]);
}

async function acumular(root: string, atual: string, hash: ReturnType<typeof createHash>): Promise<void> {
  let entradas: Dirent[];
  try {
    entradas = await readdir(atual, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const absoluto = join(atual, entrada.name);
    const rel = relative(root, absoluto).split(sep).join('/');
    if (!relevante(rel)) continue;
    if (entrada.isDirectory()) {
      await acumular(root, absoluto, hash);
    } else if (entrada.isFile()) {
      const dados = await readFile(absoluto);
      hash.update(rel).update('\0').update(String(dados.length)).update('\0').update(dados);
    }
  }
}

export async function hashConteudoCodigoBase(diretorio: string): Promise<string> {
  const hash = createHash('sha256');
  await acumular(diretorio, diretorio, hash);
  return hash.digest('hex');
}
