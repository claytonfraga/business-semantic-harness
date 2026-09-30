import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Store } from 'n3';
import { loadManifest } from '../project/manifest.js';
import { parseOntology, parseShapes } from '../ontology/rdf.js';
import { validateData, type DataValidationResult } from '../ontology/validate.js';

export interface DomainSummary {
  id: string;
  version?: string;
  baseIri?: string;
  ontologyPath: string;
  shapesPath: string;
  classesCount: number;
  shapesCount: number;
  description?: string;
}

export interface DomainValidator {
  domainId: string;
  ontologyStore: Store;
  shapesStore: Store;
  validateChanges: (dataStore: Store) => Promise<DataValidationResult>;
}

/**
 * Scans and catalogs available domains in projectRoot under .bsh/
 */
export async function getAvailableDomains(projectRoot: string = process.cwd()): Promise<DomainSummary[]> {
  const domains: DomainSummary[] = [];

  // Try reading from manifest first
  try {
    const manifest = await loadManifest(projectRoot);
    for (const d of manifest.domains) {
      const ontRel = d.ontology.startsWith('.bsh/') ? d.ontology : join('.bsh', d.ontology);
      const shRel = d.shapes.startsWith('.bsh/') ? d.shapes : join('.bsh', d.shapes);
      const summary = await inspectDomain(projectRoot, d.id, ontRel, shRel, d.version, d.baseIri);
      domains.push(summary);
    }
    return domains;
  } catch {
    // If no manifest, scan .bsh/domains/ directly
  }

  const domainsDir = join(projectRoot, '.bsh', 'domains');
  try {
    const entries = await readdir(domainsDir);
    for (const entry of entries) {
      const entryPath = join(domainsDir, entry);
      const st = await stat(entryPath);
      if (st.isDirectory()) {
        const ontPath = join('.bsh', 'domains', entry, 'ontology.jsonld');
        const shPath = join('.bsh', 'domains', entry, 'shapes.ttl');
        try {
          const summary = await inspectDomain(projectRoot, entry, ontPath, shPath);
          domains.push(summary);
        } catch {
          // Incomplete domain folder, skip
        }
      }
    }
  } catch {
    // No .bsh/domains directory
  }

  return domains;
}

async function inspectDomain(
  projectRoot: string,
  id: string,
  ontologyRelPath: string,
  shapesRelPath: string,
  version?: string,
  baseIri?: string
): Promise<DomainSummary> {
  const ontFullPath = join(projectRoot, ontologyRelPath);
  const shFullPath = join(projectRoot, shapesRelPath);

  let classesCount = 0;
  let description: string | undefined;
  try {
    const ontRaw = await readFile(ontFullPath, 'utf8');
    const parsed = JSON.parse(ontRaw);
    if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
      const classes = parsed['@graph'].filter(
        (node: { '@type'?: string | string[] }) =>
          node['@type'] === 'owl:Class' ||
          node['@type'] === 'rdfs:Class' ||
          (Array.isArray(node['@type']) && (node['@type'].includes('owl:Class') || node['@type'].includes('rdfs:Class')))
      );
      classesCount = classes.length;
      const domainNode = parsed['@graph'].find((node: { '@type'?: string }) => node['@type'] === 'bsh:Domain');
      description = domainNode?.['rdfs:comment'] || domainNode?.description;
    }
  } catch {
    // Best-effort extraction
  }

  let shapesCount = 0;
  try {
    const shRaw = await readFile(shFullPath, 'utf8');
    // Count occurrences of NodeShape and PropertyShape
    const matches = shRaw.match(/(?:sh:NodeShape|sh:PropertyShape|a\s+sh:NodeShape)/g);
    shapesCount = matches ? matches.length : 0;
  } catch {
    // Best-effort extraction
  }

  return {
    id,
    version,
    baseIri,
    ontologyPath: ontFullPath,
    shapesPath: shFullPath,
    classesCount,
    shapesCount,
    description,
  };
}

/**
 * Loads ontology and SHACL stores for a selected domain and returns an executable validator.
 */
export async function loadDomainValidator(
  projectRoot: string,
  domainId: string
): Promise<DomainValidator> {
  const domains = await getAvailableDomains(projectRoot);
  const target = domains.find((d) => d.id === domainId);
  if (!target) {
    throw new Error(`Domain '${domainId}' not found in project ${projectRoot}`);
  }

  const ontContent = await readFile(target.ontologyPath, 'utf8');
  const shContent = await readFile(target.shapesPath, 'utf8');

  const ontologyStore = await parseOntology(ontContent);
  const shapesStore = await parseShapes(shContent);

  return {
    domainId,
    ontologyStore,
    shapesStore,
    validateChanges: async (dataStore: Store) => {
      return validateData(shapesStore, dataStore);
    },
  };
}
