import { readFile, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

export interface DomainAffinityResult {
  status: 'ALIGNED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  score: number;
  indicatorType: 'SAMPLED_LEXICAL_OVERLAP';
  sampledFilesCount: number;
  totalTokensAnalyzed: number;
  ontologyTerms: string[];
  matchedTerms: string[];
  missingTerms: string[];
  summary: string;
  recommendation?: string;
  limitations: string;
}

export const AFFINITY_LIMITATIONS =
  'Indicador heurístico baseado exclusivamente em sobreposição lexical amostrada. Não comprova conformidade semântica nem substitui validação SHACL, extração estrutural de fatos ou autorização de promoção.';


const RELEVANT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
  '.json', '.yaml', '.yml', '.proto', '.graphql'
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.bsh', 'dist', 'build', 'coverage',
  '.gemini', '.turbo', '.next', '.cache', 'target', 'vendor'
]);

// Common cross-language concept stems for domain vocabulary
const CONCEPT_ALIASES: Record<string, string[]> = {
  ativo: ['asset', 'ativo', 'item', 'patrimonio'],
  transferencia: ['transfer', 'transferencia', 'move', 'movement'],
  baixa: ['retire', 'retirement', 'baixa', 'decommission', 'discard'],
  responsavel: ['responsible', 'responsavel', 'owner', 'custodian'],
  localizacao: ['location', 'localizacao', 'place', 'site'],
  estado: ['status', 'state', 'estado', 'condition'],
  solicitante: ['requester', 'solicitante', 'applicant', 'author'],
  aprovador: ['approver', 'aprovador', 'reviewer'],
  motivo: ['reason', 'motivo', 'justification'],
};

export const DOMAIN_PACKAGE_ALIASES: Map<string, Record<string, string[]>> = new Map();

export function registerDomainConceptAliases(domainId: string, aliases: Record<string, string[]>): void {
  const existing = DOMAIN_PACKAGE_ALIASES.get(domainId) || {};
  DOMAIN_PACKAGE_ALIASES.set(domainId, { ...existing, ...aliases });
}

/**
 * Extracts key domain concepts from ontology.jsonld and shapes.ttl.
 */
export async function extractOntologyConcepts(
  ontologyPath: string,
  shapesPath: string
): Promise<string[]> {
  const concepts = new Set<string>();

  // Extract from ontology.jsonld
  try {
    const ontRaw = await readFile(ontologyPath, 'utf8');
    const parsed = JSON.parse(ontRaw);
    const graph = parsed['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);

    for (const node of graph) {
      const id = node['@id'] || '';
      const parts = id.split(':');
      const localName = parts.length > 1 ? (parts.pop() || '') : id;
      if (localName && localName !== 'ontology' && localName.length > 2) {
        concepts.add(localName);
      }
      if (typeof node['rdfs:label'] === 'string') {
        concepts.add(node['rdfs:label']);
      }
    }
  } catch {
    // Best-effort
  }

  // Extract from shapes.ttl
  try {
    const shRaw = await readFile(shapesPath, 'utf8');
    // Match targetClass ex:Something
    const targetMatches = shRaw.matchAll(/sh:targetClass\s+(?:ex:|[\w-]+:)(\w+)/g);
    for (const m of targetMatches) {
      concepts.add(m[1]);
    }
    // Match shape names
    const shapeMatches = shRaw.matchAll(/(?:ex:|[\w-]+:)(\w+Shape)/g);
    for (const m of shapeMatches) {
      concepts.add(m[1].replace(/Shape$/, ''));
    }
    // Match paths
    const pathMatches = shRaw.matchAll(/sh:path\s+(?:ex:|[\w-]+:)(\w+)/g);
    for (const m of pathMatches) {
      concepts.add(m[1]);
    }
  } catch {
    // Best-effort
  }

  return Array.from(concepts);
}

/**
 * Recursively scans project files to extract tokens and identifiers.
 */
async function scanProjectTokens(
  dir: string,
  maxFiles = 40,
  currentDepth = 0,
  maxDepth = 4
): Promise<{ tokens: Set<string>; fileCount: number }> {
  const tokens = new Set<string>();
  let fileCount = 0;

  if (currentDepth > maxDepth) return { tokens, fileCount };

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await scanProjectTokens(fullPath, maxFiles - fileCount, currentDepth + 1, maxDepth);
        fileCount += sub.fileCount;
        for (const t of sub.tokens) tokens.add(t);
        if (fileCount >= maxFiles) break;
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        // Add file basename as a token
        const base = basename(entry.name, ext).toLowerCase();
        for (const part of base.split(/[-_.]+/)) {
          if (part.length > 2) tokens.add(part);
        }

        if (RELEVANT_EXTENSIONS.has(ext)) {
          fileCount++;
          try {
            const content = await readFile(fullPath, 'utf8');
            // Extract word tokens (limit to first 30KB per file)
            const snippet = content.slice(0, 30000);
            const words = snippet.match(/[a-zA-Z0-9_\u00C0-\u00FF]{3,}/g) || [];
            for (const w of words) {
              tokens.add(w.toLowerCase());
            }
          } catch {
            // Ignore unreadable files
          }
          if (fileCount >= maxFiles) break;
        }
      }
    }
  } catch {
    // Ignore directory read error
  }

  return { tokens, fileCount };
}

/**
 * Checks whether the active domain ontology aligns with the project codebase concepts.
 */
export async function checkDomainAffinity(
  projectRoot: string,
  ontologyPath: string,
  shapesPath: string,
  domainId = 'default',
  customAliases?: Record<string, string[]>
): Promise<DomainAffinityResult> {
  const ontologyTerms = await extractOntologyConcepts(ontologyPath, shapesPath);
  const { tokens: projectTokens, fileCount } = await scanProjectTokens(projectRoot);

  const domainAliases = {
    ...CONCEPT_ALIASES,
    ...(DOMAIN_PACKAGE_ALIASES.get(domainId) || {}),
    ...(customAliases || {}),
  };

  if (fileCount === 0 || ontologyTerms.length === 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      score: 0.0,
      indicatorType: 'SAMPLED_LEXICAL_OVERLAP',
      sampledFilesCount: fileCount,
      totalTokensAnalyzed: projectTokens.size,
      ontologyTerms,
      matchedTerms: [],
      missingTerms: ontologyTerms,
      summary: `Projeto sem arquivos de código suficientes para validação de sobreposição lexical (${fileCount} arquivos analisados). Ausência de dados não constitui afinidade semântica.`,
      limitations: AFFINITY_LIMITATIONS,
    };
  }

  const matchedTerms: string[] = [];
  const missingTerms: string[] = [];

  for (const term of ontologyTerms) {
    const termLower = term.toLowerCase();
    let found = false;

    // Direct token or substring match
    if (projectTokens.has(termLower)) {
      found = true;
    } else {
      // Check aliases
      for (const [key, aliases] of Object.entries(domainAliases)) {
        if (termLower.includes(key)) {
          for (const alias of aliases) {
            if (projectTokens.has(alias)) {
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
    }

    if (!found && termLower.length >= 4) {
      // Check if any project token contains the full concept term (e.g. 'assetService' contains 'asset')
      for (const token of projectTokens) {
        if (token.includes(termLower)) {
          found = true;
          break;
        }
      }
    }

    if (found) {
      matchedTerms.push(term);
    } else {
      missingTerms.push(term);
    }
  }

  const score = ontologyTerms.length > 0 ? matchedTerms.length / ontologyTerms.length : 1.0;

  // Thresholds: aligned if score >= 0.15 or (matchedTerms >= 5 and score >= 0.05)
  if (score >= 0.15 || (matchedTerms.length >= 5 && score >= 0.05)) {
    return {
      status: 'ALIGNED',
      score: Number(score.toFixed(2)),
      indicatorType: 'SAMPLED_LEXICAL_OVERLAP',
      sampledFilesCount: fileCount,
      totalTokensAnalyzed: projectTokens.size,
      ontologyTerms,
      matchedTerms,
      missingTerms,
      summary: `Afinidade semântica confirmada (${matchedTerms.length}/${ontologyTerms.length} conceitos encontrados no projeto).`,
      limitations: AFFINITY_LIMITATIONS,
    };
  }

  const previewMissing = missingTerms.slice(0, 4).join(', ');
  return {
    status: 'MISMATCH',
    score: Number(score.toFixed(2)),
    indicatorType: 'SAMPLED_LEXICAL_OVERLAP',
    sampledFilesCount: fileCount,
    totalTokensAnalyzed: projectTokens.size,
    ontologyTerms,
    matchedTerms,
    missingTerms,
    summary: `Baixa afinidade semântica: conceitos do domínio '${domainId}' (${previewMissing}...) não foram encontrados no projeto.`,
    recommendation: `Pressione [Ctrl+D] para trocar a ontologia ativa ou [Ctrl+G] para desabilitar o harness ontológico.`,
    limitations: AFFINITY_LIMITATIONS,
  };
}
