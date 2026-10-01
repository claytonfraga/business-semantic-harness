import { realpath } from 'node:fs/promises';
import { isAbsolute, relative as relativePath, resolve, sep } from 'node:path';

export async function resolveProjectFile(root: string, relative: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  if (!relative || isAbsolute(relative)) {
    throw new Error(`Caminho fora do projeto: ${relative}`);
  }

  const lexicalTarget = resolve(canonicalRoot, relative);
  if (lexicalTarget === canonicalRoot || !lexicalTarget.startsWith(canonicalRoot + sep)) {
    throw new Error(`Caminho fora do projeto: ${relative}`);
  }

  const canonicalTarget = await realpath(lexicalTarget);
  const fromRoot = relativePath(canonicalRoot, canonicalTarget);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Caminho fora do projeto: ${relative}`);
  }
  return canonicalTarget;
}

export async function assertProjectDirectory(root: string, directory: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const canonicalDirectory = await realpath(directory);
  const fromRoot = relativePath(canonicalRoot, canonicalDirectory);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Diretório fora do projeto: ${directory}`);
  }
}
