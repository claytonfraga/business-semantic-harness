import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { loadManifest, type ProjectManifest } from './manifest.js';

function projectIdFrom(root: string): string {
  const id = basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  return id || 'project';
}

export async function initProject(root: string): Promise<void> {
  const oracleDir = join(root, '.oracle');
  await mkdir(oracleDir, { recursive: true });
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: projectIdFrom(root),
    domains: [],
  };
  try {
    await writeFile(join(oracleDir, 'project.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (hasCode(error, 'EEXIST')) {
      throw new Error('Manifesto do Oracle já existe');
    }
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function addDomain(root: string, id: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`Identificador de domínio inválido: ${id}`);
  }
  const manifest = await loadManifest(root);
  if (manifest.domains.some((domain) => domain.id === id)) {
    throw new Error(`Domínio já existe: ${id}`);
  }

  const oracleDir = join(root, '.oracle');
  const domainDir = join(oracleDir, 'domains', id);
  await mkdir(join(oracleDir, 'domains'), { recursive: true });
  try {
    await mkdir(domainDir);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) {
      throw new Error(`Domínio já existe: ${id}`);
    }
    throw error;
  }

  const baseIri = `urn:${manifest.projectId}:${id}:`;
  const ontology = {
    '@context': {
      oracle: 'urn:oracle:ns:v1:',
      domain: baseIri,
    },
    '@graph': [{ '@id': 'domain:ontology', '@type': 'oracle:Domain', 'oracle:version': '1.0.0' }],
  };
  await writeFile(join(domainDir, 'ontology.jsonld'), JSON.stringify(ontology, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(domainDir, 'shapes.ttl'), `@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix domain: <${baseIri}> .\n`, { flag: 'wx' });

  manifest.domains.push({
    id,
    version: '1.0.0',
    baseIri,
    ontology: `domains/${id}/ontology.jsonld`,
    shapes: `domains/${id}/shapes.ttl`,
  });
  const manifestPath = join(oracleDir, 'project.json');
  const previous = await readFile(manifestPath, 'utf8');
  const tempPath = join(oracleDir, `project.json.${process.pid}.tmp`);
  try {
    if (previous !== await readFile(manifestPath, 'utf8')) {
      throw new Error('Manifesto alterado durante a criação do domínio');
    }
    await writeFile(tempPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await rename(tempPath, manifestPath);
  } catch (error) {
    throw error;
  }
}
