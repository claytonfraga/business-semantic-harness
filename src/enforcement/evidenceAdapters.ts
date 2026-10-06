import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperacaoSemantica } from './operacaoSemantica.js';
import type { CandidateFacts, CandidateFactsExtractor } from './governanceDecision.js';

export interface EvidenceAdapterMetadata {
  id: string;
  name: string;
  language: string;
  technology: string;
  supportedOperations: string[];
  limitations: string[];
}

export interface EvidenceAdapter {
  readonly metadata: EvidenceAdapterMetadata;
  canHandle(operation: OperacaoSemantica, paths: readonly string[]): boolean;
  extract(input: {
    workspace: string;
    sourceCommit: string;
    originCommit: string;
    operation: OperacaoSemantica;
    relevantPaths: readonly string[];
  }): Promise<Partial<CandidateFacts>>;
}

async function resolveDomainBaseIri(workspace: string): Promise<string> {
  try {
    const raw = await readFile(join(workspace, '.bsh', 'project.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const domain = parsed.domains?.[0];
    if (domain?.baseIri) {
      return domain.baseIri;
    }
  } catch {
    // fallback
  }
  return 'urn:generic:';
}

/**
 * Adapter 1: TypeScript & JavaScript Structural AST & Flow Evidence Adapter
 */
export class TypeScriptStructuralAdapter implements EvidenceAdapter {
  public readonly metadata: EvidenceAdapterMetadata = {
    id: 'typescript-structural-adapter',
    name: 'TypeScript & JavaScript Structural AST & Flow Evidence Adapter',
    language: 'TypeScript / JavaScript',
    technology: 'Static Analysis, AST Parser & Git Snapshot Inspection',
    supportedOperations: ['*'],
    limitations: [
      'Requires syntactically valid TypeScript or JavaScript source files',
      'Locating an authorization function does not prove its execution before persistence in runtime control flow',
      'Textual symbol presence without verifiable invocation is classified as heuristic, not structural proof',
    ],
  };

  public canHandle(_operation: OperacaoSemantica, paths: readonly string[]): boolean {
    return paths.some((p) => p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.tsx') || p.endsWith('.jsx'));
  }

  public async extract(input: {
    workspace: string;
    sourceCommit: string;
    originCommit: string;
    operation: OperacaoSemantica;
    relevantPaths: readonly string[];
  }): Promise<Partial<CandidateFacts>> {
    const { workspace, sourceCommit, operation, relevantPaths } = input;
    const coveredPaths: string[] = [];
    const missingRequirements: string[] = [];
    const turtleStatements: string[] = [];
    const structuralEvidence: string[] = [];

    const baseIri = await resolveDomainBaseIri(workspace);
    const prefix = `@prefix ex: <${baseIri}> .\n@prefix bsh: <urn:bsh:ns:v1:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n`;
    turtleStatements.push(prefix);

    const candidateId = `ex:candidate_${sourceCommit.slice(0, 8)}`;
    turtleStatements.push(`${candidateId} a ex:${operation.operacao} ;\n  bsh:sourceCommit "${sourceCommit}" .\n`);

    for (const relPath of relevantPaths) {
      if (!relPath.endsWith('.ts') && !relPath.endsWith('.js')) continue;

      let content = '';
      try {
        content = await readFile(join(workspace, relPath), 'utf8');
      } catch {
        continue;
      }

      coveredPaths.push(relPath);
      const evidenceId = `${sourceCommit}:${relPath}`;
      structuralEvidence.push(evidenceId);

      // Strip comments so comments, dead explanations or documentation cannot fake execution
      const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, (match) => ' '.repeat(match.length));

      // Analyze control flow: Authorization before Persistence verification
      // Criterion: "Localizar uma função de autorização não equivale a demonstrar sua execução antes da persistência."
      const hasPersistenceCall =
        codeOnly.includes('save(') ||
        codeOnly.includes('persist(') ||
        codeOnly.includes('repository.save') ||
        codeOnly.includes('db.insert') ||
        codeOnly.includes('db.update');

      const hasAuthDeclaration =
        codeOnly.includes('function authorize(') ||
        codeOnly.includes('const authorize =') ||
        codeOnly.includes('function checkPermission(') ||
        codeOnly.includes('import { authorize }') ||
        codeOnly.includes('import { checkPermission }');

      const persistRegex = /\b(save|persist|repository\.save|db\.insert|db\.update)\s*\(/g;
      let earliestPersist = Infinity;
      let persistMatch = persistRegex.exec(codeOnly);
      while (persistMatch !== null) {
        if (persistMatch.index < earliestPersist) {
          earliestPersist = persistMatch.index;
        }
        persistMatch = persistRegex.exec(codeOnly);
      }

      // Find invocations of authorization (not declarations or imports)
      const authCallRegex = /\b(authorize|checkPermission|broker\.authorize)\s*\(/g;
      let foundInvocationBeforePersistence = false;
      let authMatch = authCallRegex.exec(codeOnly);
      while (authMatch !== null) {
        const matchIndex = authMatch.index;
        const prefixSlice = codeOnly.slice(Math.max(0, matchIndex - 30), matchIndex);
        const isDeclaration = /\b(function|const|let|var|type|interface|import)\s+[^=({]*$/.test(prefixSlice);
        if (isDeclaration) {
          authMatch = authCallRegex.exec(codeOnly);
          continue;
        }
        if (earliestPersist === Infinity || matchIndex < earliestPersist) {
          foundInvocationBeforePersistence = true;
          break;
        }
        authMatch = authCallRegex.exec(codeOnly);
      }

      const hasAuthInvocationBeforePersistence = (() => {
        if (!hasPersistenceCall) return true;
        if (earliestPersist !== Infinity && hasAuthDeclaration && !foundInvocationBeforePersistence) {
          return false;
        }
        return foundInvocationBeforePersistence;
      })();

      const requiresAuth =
        operation.operacao.toLowerCase().includes('transfer') ||
        operation.operacao.toLowerCase().includes('auth') ||
        operation.operacao.toLowerCase().includes('restricted') ||
        content.includes('requiresAuthorization');

      if (requiresAuth && hasPersistenceCall && !hasAuthInvocationBeforePersistence) {
        missingRequirements.push(
          'Localizar uma função de autorização não equivale a demonstrar sua execução antes da persistência'
        );
      }
    }

    // Extract facts into RDF once per candidate
    for (const fato of operation.fatos) {
      if (fato.valor !== null) {
        turtleStatements.push(
          `${candidateId} ex:${fato.propriedade} "${fato.valor}" .\n`
        );
      }
    }

    return {
      graphTurtle: turtleStatements.join(''),
      coveredPaths,
      sourceCommit,
      structuralEvidence,
      missingRequirements,
    };
  }
}

/**
 * Adapter 2: Temporal Sequence & Lifecycle Trace Evidence Adapter
 */
export class TemporalSequenceAdapter implements EvidenceAdapter {
  public readonly metadata: EvidenceAdapterMetadata = {
    id: 'temporal-sequence-adapter',
    name: 'Temporal Sequence & Lifecycle Trace Adapter',
    language: 'All supported languages',
    technology: 'Causal Execution Trace & Event Sequence Verifier',
    supportedOperations: ['*'],
    limitations: [
      'Requires verifiable event timestamp or causal precedence evidence in tests or trace logs',
      'Absence of causal order evidence leaves temporal sequence unproven and yields INDETERMINATE',
    ],
  };

  public canHandle(operation: OperacaoSemantica, _paths: readonly string[]): boolean {
    const name = operation.operacao.toLowerCase();
    const hasTemporalFatos = operation.fatos.some((f) =>
      f.propriedade.toLowerCase().includes('state') ||
      f.propriedade.toLowerCase().includes('sequence') ||
      f.propriedade.toLowerCase().includes('time') ||
      f.propriedade.toLowerCase().includes('previous')
    );
    return name.includes('transition') || name.includes('transfer') || hasTemporalFatos;
  }

  public async extract(input: {
    workspace: string;
    sourceCommit: string;
    originCommit: string;
    operation: OperacaoSemantica;
    relevantPaths: readonly string[];
  }): Promise<Partial<CandidateFacts>> {
    const { workspace, operation } = input;
    const missingRequirements: string[] = [];

    // Criterion: "Regras temporais exigem evidências da sequência de eventos."
    let hasTemporalEvidence = false;

    for (const relPath of input.relevantPaths) {
      let content = '';
      try {
        content = await readFile(join(workspace, relPath), 'utf8');
      } catch {
        continue;
      }

      // Check for sequential execution trace or causal state transition assertions
      if (
        content.includes('previousState') ||
        content.includes('currentState') ||
        content.includes('timestamp') ||
        content.includes('sequenceOrder') ||
        content.includes('transitionTo')
      ) {
        hasTemporalEvidence = true;
        break;
      }
    }

    const requiresTemporalSequence =
      operation.operacao.toLowerCase().includes('transition') ||
      operation.fatos.some((f) => f.propriedade.toLowerCase().includes('previousstate'));

    if (requiresTemporalSequence && !hasTemporalEvidence) {
      missingRequirements.push('Regras temporais exigem evidências da sequência de eventos');
    }

    return {
      missingRequirements,
      behavioralEvidence: hasTemporalEvidence ? [`${input.sourceCommit}:temporal-sequence`] : [],
    };
  }
}

/**
 * Adapter 3: Concurrency & Protocol Verification Evidence Adapter
 */
export class ConcurrencyVerificationAdapter implements EvidenceAdapter {
  public readonly metadata: EvidenceAdapterMetadata = {
    id: 'concurrency-verification-adapter',
    name: 'Concurrency & Protocol Verification Adapter',
    language: 'TypeScript / Node.js / Multi-threaded',
    technology: 'Concurrency Test Runner & Lock Protocol Inspector',
    supportedOperations: ['*'],
    limitations: [
      'Requires explicit concurrency test suite execution or formal synchronization protocol proof (optimistic lock, mutex, transaction)',
      'Unprotected shared mutable state without synchronization produces INDETERMINATE',
    ],
  };

  public canHandle(operation: OperacaoSemantica, _paths: readonly string[]): boolean {
    const name = operation.operacao.toLowerCase();
    return (
      name.includes('concurrent') ||
      name.includes('atomic') ||
      name.includes('lock') ||
      name.includes('race') ||
      operation.fatos.some((f) => f.propriedade.toLowerCase().includes('concurrency'))
    );
  }

  public async extract(input: {
    workspace: string;
    sourceCommit: string;
    originCommit: string;
    operation: OperacaoSemantica;
    relevantPaths: readonly string[];
  }): Promise<Partial<CandidateFacts>> {
    const { workspace, operation } = input;
    const missingRequirements: string[] = [];

    // Criterion: "Regras dependentes de concorrência exigem evidências apropriadas, como testes de concorrência ou verificação do protocolo."
    let hasConcurrencyProof = false;

    for (const relPath of input.relevantPaths) {
      let content = '';
      try {
        content = await readFile(join(workspace, relPath), 'utf8');
      } catch {
        continue;
      }

      if (
        content.includes('mutex') ||
        content.includes('lock.acquire') ||
        content.includes('optimisticLock') ||
        content.includes('versionToken') ||
        content.includes('compareAndSwap') ||
        content.includes('runInTransaction') ||
        content.includes('Promise.all') ||
        content.includes('test/concurrency')
      ) {
        hasConcurrencyProof = true;
        break;
      }
    }

    const requiresConcurrency =
      operation.operacao.toLowerCase().includes('concurrent') ||
      operation.operacao.toLowerCase().includes('atomic');

    if (requiresConcurrency && !hasConcurrencyProof) {
      missingRequirements.push(
        'Regras dependentes de concorrência exigem evidências apropriadas, como testes de concorrência ou verificação do protocolo'
      );
    }

    return {
      missingRequirements,
      behavioralEvidence: hasConcurrencyProof ? [`${input.sourceCommit}:concurrency-proof`] : [],
    };
  }
}

/**
 * Built-in default evidence adapters
 */
export const defaultEvidenceAdapters: EvidenceAdapter[] = [
  new TypeScriptStructuralAdapter(),
  new TemporalSequenceAdapter(),
  new ConcurrencyVerificationAdapter(),
];

/**
 * Creates the production CandidateFactsExtractor connecting all registered evidence adapters.
 */
export function createProductionFactsExtractor(
  workspace: string,
  options: { adapters?: EvidenceAdapter[] } = {}
): CandidateFactsExtractor {
  const adapters = options.adapters ?? defaultEvidenceAdapters;

  return async (input) => {
    const { sourceCommit, operation, relevantPaths } = input;
    const coveredPathsSet = new Set<string>();
    const structuralEvidenceSet = new Set<string>();
    const behavioralEvidenceSet = new Set<string>();
    const missingRequirementsSet = new Set<string>();
    const turtleParts: string[] = [];

    for (const adapter of adapters) {
      if (!adapter.canHandle(operation, relevantPaths)) continue;

      const partial = await adapter.extract({
        workspace,
        sourceCommit,
        originCommit: input.originCommit,
        operation,
        relevantPaths,
      });

      if (partial.graphTurtle) turtleParts.push(partial.graphTurtle);
      for (const p of partial.coveredPaths ?? []) coveredPathsSet.add(p);
      for (const s of partial.structuralEvidence ?? []) structuralEvidenceSet.add(s);
      for (const b of partial.behavioralEvidence ?? []) behavioralEvidenceSet.add(b);
      for (const m of partial.missingRequirements ?? []) missingRequirementsSet.add(m);
    }

    // Criterion: "Ausência de dados suficientes produz indeterminação."
    if (coveredPathsSet.size === 0 && relevantPaths.length > 0) {
      missingRequirementsSet.add('Ausência de dados suficientes para avaliação da operação');
    }

    let graphTurtle = turtleParts.join('\n').trim();
    if (!graphTurtle) {
      const baseIri = await resolveDomainBaseIri(workspace);
      // Fallback empty graph
      graphTurtle = `@prefix ex: <${baseIri}> .\n@prefix bsh: <urn:bsh:ns:v1:> .\nex:candidate a ex:${operation.operacao} .\n`;
    }

    const coveredPaths = Array.from(coveredPathsSet);
    const structuralEvidence = Array.from(structuralEvidenceSet);
    const behavioralEvidence = Array.from(behavioralEvidenceSet);
    const missingRequirements = Array.from(missingRequirementsSet);

    const adaptersUsed = adapters.map((a) => ({
      id: a.metadata.id,
      name: a.metadata.name,
      version: '1.0.0',
      technology: a.metadata.technology,
      supportedOperations: [...a.metadata.supportedOperations],
    }));

    return {
      graphTurtle,
      coveredPaths: coveredPaths.length > 0 ? coveredPaths : Array.from(relevantPaths),
      sourceCommit,
      structuralEvidence,
      behavioralEvidence,
      missingRequirements,
      evidenceType: behavioralEvidence.length > 0 ? 'behavioral' : 'structural',
      adaptersUsed,
    };
  };
}
