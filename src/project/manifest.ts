import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProjectFile } from './paths.js';

export interface CompositeOperationRelation {
  fromConcept: string;
  toConcept: string;
  relationship: string;
  state?: string;
  unit?: string;
}

export interface CompositeOperation {
  name: string;
  description?: string;
  relations: CompositeOperationRelation[];
}

export interface CompetencyQuestionQuery {
  id: string;
  competencyQuestion: string;
  query: string;
  expectedResultPattern?: string;
}

export interface ProjectDomain {
  id: string;
  version: string;
  baseIri: string;
  ontology: string;
  shapes: string;
  enforcement?: string;
  supportedLanguages?: string[];
  dependencies?: Record<string, string>;
  aliases?: Record<string, string[]>;
  compositeOperations?: CompositeOperation[];
  sparqlQueries?: CompetencyQuestionQuery[];
  requestGovernance?: RequestGovernance;
}

export interface RequestGovernance {
  unmatchedMutation: 'ALLOW' | 'HUMAN_REVIEW' | 'INSUFFICIENT_INFORMATION';
  rules: Array<{ id: string; pattern: string; effect: 'ALLOW' | 'BLOCK' | 'HUMAN_REVIEW'; reference: string; purposes?: Array<'EXECUTION' | 'EXPLANATION' | 'INSPECTION' | 'TESTING'> }>;
}

function requestGovernance(value: unknown): RequestGovernance | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !['ALLOW', 'HUMAN_REVIEW', 'INSUFFICIENT_INFORMATION'].includes(String(value.unmatchedMutation)) || !Array.isArray(value.rules)) {
    throw new Error('Invalid requestGovernance configuration');
  }
  for (const rule of value.rules) {
    if (!isRecord(rule) || typeof rule.id !== 'string' || !rule.id || typeof rule.pattern !== 'string' || !rule.pattern || rule.pattern.length > 1000 || typeof rule.reference !== 'string' || !rule.reference || !['ALLOW', 'BLOCK', 'HUMAN_REVIEW'].includes(String(rule.effect))) throw new Error('Invalid requestGovernance rule');
    if (rule.purposes !== undefined && (!Array.isArray(rule.purposes) || !rule.purposes.length || rule.purposes.some(p => !['EXECUTION', 'EXPLANATION', 'INSPECTION', 'TESTING'].includes(String(p))))) throw new Error('Invalid requestGovernance purposes');
    try { new RegExp(rule.pattern, 'iu'); } catch { throw new Error('Invalid requestGovernance pattern'); }
  }
  return value as unknown as RequestGovernance;
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

export function validateDomainPackagesCompatibility(domains: ProjectDomain[]): {
  compatible: boolean;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const domainMap = new Map(domains.map((d) => [d.id, d]));

  for (const domain of domains) {
    if (domain.dependencies) {
      for (const [depId, requiredVersion] of Object.entries(domain.dependencies)) {
        const depDomain = domainMap.get(depId);
        if (!depDomain) {
          diagnostics.push(`Incompatibilidade de dependência: Domínio '${domain.id}' requer o pacote '${depId}', mas ele não está declarado no projeto.`);
          continue;
        }
        const cleanReq = requiredVersion.replace(/^[\^~]/, '');
        const cleanActual = depDomain.version.replace(/^[\^~]/, '');
        const reqMajor = cleanReq.split('.')[0];
        const actMajor = cleanActual.split('.')[0];
        if (reqMajor !== actMajor) {
          diagnostics.push(
            `Incompatibilidade de versão: Domínio '${domain.id}' requer '${depId}@${requiredVersion}', mas encontrou versão incompatível '${depDomain.version}'.`
          );
        }
      }
    }
  }

  return {
    compatible: diagnostics.length === 0,
    diagnostics,
  };
}

export function isLanguageSupportedByDomain(
  domain: ProjectDomain,
  languageOrExt: string
): { supported: boolean; warning?: string } {
  if (!domain.supportedLanguages || domain.supportedLanguages.length === 0) {
    return { supported: true };
  }
  const clean = languageOrExt.toLowerCase().replace(/^\./, '');
  const isMatch = domain.supportedLanguages.some((l) => l.toLowerCase().replace(/^\./, '') === clean);
  if (!isMatch) {
    return {
      supported: false,
      warning: `O domínio '${domain.id}' declara suporte a [${domain.supportedLanguages.join(', ')}], que não inclui '${languageOrExt}'. O suporte a um domínio não implica suporte automático a qualquer linguagem.`,
    };
  }
  return { supported: true };
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
    const enforcement = typeof item.enforcement === 'string' && item.enforcement.trim()
      ? item.enforcement.trim()
      : undefined;

    const supportedLanguages = Array.isArray(item.supportedLanguages)
      ? item.supportedLanguages.filter((l): l is string => typeof l === 'string')
      : undefined;

    const dependencies = isRecord(item.dependencies)
      ? Object.fromEntries(
          Object.entries(item.dependencies).filter(([, v]) => typeof v === 'string') as [string, string][]
        )
      : undefined;

    const aliases = isRecord(item.aliases)
      ? (item.aliases as Record<string, string[]>)
      : undefined;

    const compositeOperations = Array.isArray(item.compositeOperations)
      ? (item.compositeOperations as CompositeOperation[])
      : undefined;

    const sparqlQueries = Array.isArray(item.sparqlQueries)
      ? (item.sparqlQueries as CompetencyQuestionQuery[])
      : undefined;

    return {
      id,
      version,
      baseIri,
      ontology: requiredString(item.ontology, `domains[${index}].ontology`),
      shapes: requiredString(item.shapes, `domains[${index}].shapes`),
      enforcement,
      supportedLanguages,
      dependencies,
      aliases,
      compositeOperations,
      sparqlQueries,
      requestGovernance: requestGovernance(item.requestGovernance),
    };
  });

  return { schemaVersion: 1, projectId, domains };
}
