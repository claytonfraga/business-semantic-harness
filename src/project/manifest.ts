export interface ProjectDomain {
  id: string;
  version: string;
  baseIri: string;
  ontology: string;
  shapes: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  domains: ProjectDomain[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo obrigatório inválido: ${name}`);
  }
  return value;
}

export async function loadManifest(projectRoot: string): Promise<ProjectManifest> {
  let manifestPath: string;
  try {
    manifestPath = await resolveProjectFile(projectRoot, join('.bsh', 'project.json'));
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      throw new Error('Manifesto do BSH ausente: .bsh/project.json');
    }
    throw error;
  }

  let source: unknown;
  try {
    source = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Manifesto inválido: ${manifestPath}`, { cause: error });
  }
  if (!isRecord(source)) {
    throw new Error('Manifesto inválido: objeto JSON esperado');
  }
  if (source.schemaVersion !== 1) {
    throw new Error(`Versão de formato não suportada: ${String(source.schemaVersion)}`);
  }
  const projectId = requiredString(source.projectId, 'projectId');
  if (!Array.isArray(source.domains)) {
    throw new Error('Campo obrigatório inválido: domains');
  }

  const identifiers = new Set<string>();
  const domains = source.domains.map((item: unknown, index: number): ProjectDomain => {
    if (!isRecord(item)) {
      throw new Error(`Domínio inválido no índice ${index}`);
    }
    const id = requiredString(item.id, `domains[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(`Identificador de domínio inválido: ${id}`);
    }
    if (identifiers.has(id)) {
      throw new Error(`Domínio duplicado: ${id}`);
    }
    identifiers.add(id);
    const version = requiredString(item.version, `domains[${index}].version`);
    const baseIri = requiredString(item.baseIri, `domains[${index}].baseIri`);
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(baseIri)) {
      throw new Error(`IRI base inválido para domínio ${id}: ${baseIri}`);
    }
    return {
      id,
      version,
      baseIri,
      ontology: requiredString(item.ontology, `domains[${index}].ontology`),
      shapes: requiredString(item.shapes, `domains[${index}].shapes`),
    };
  });

  return { schemaVersion: 1, projectId, domains };
}
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProjectFile } from './paths.js';
