import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../git/worktree.js';
import { lerDiff, aplicarRegras, type DiffArquivo } from './extratorOperacoes.js';
import { carregarRegrasGovernanca, type RegraGovernanca } from './governanca.js';
import { avaliarOperacoes } from './motorEnforcement.js';
import { createOntologySnapshot, type OntologySnapshot } from '../ontology/query.js';

export interface GitNumstatResult {
  files: { path: string; linesAdded: number; linesRemoved: number }[];
  totalAdded: number;
  totalRemoved: number;
}

export async function getGitDiffNumstat(worktree: string, baseCommit?: string): Promise<GitNumstatResult> {
  const base = baseCommit || 'HEAD';
  let diffNumstat = '';
  try {
    diffNumstat = await git(worktree, ['diff', '--numstat', '-z', '-M', base]);
  } catch (err: unknown) {
    throw new Error(`Erro Git no numstat: ${err instanceof Error ? err.message : String(err)}`);
  }

  const files: { path: string; linesAdded: number; linesRemoved: number }[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  if (diffNumstat.length > 0) {
    const tokens = diffNumstat.split('\0');
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i++];
      if (!token) continue;
      const parts = token.split('\t');
      if (parts.length >= 3 && parts[2] !== '') {
        const add = parseInt(parts[0], 10) || 0;
        const rem = parseInt(parts[1], 10) || 0;
        const path = parts[2];
        files.push({ path, linesAdded: add, linesRemoved: rem });
        totalAdded += add;
        totalRemoved += rem;
      } else if (parts.length >= 2 && parts[2] === '') {
        const add = parseInt(parts[0], 10) || 0;
        const rem = parseInt(parts[1], 10) || 0;
        const _oldPath = tokens[i++];
        const newPath = tokens[i++];
        if (newPath) {
          files.push({ path: newPath, linesAdded: add, linesRemoved: rem });
          totalAdded += add;
          totalRemoved += rem;
        }
      }
    }
  }

  try {
    const untrackedRaw = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
    const untrackedTokens = untrackedRaw.split('\0').filter(Boolean);
    for (const uPath of untrackedTokens) {
      if (files.some((f) => f.path === uPath)) continue;
      let count = 0;
      try {
        const content = await readFile(join(worktree, uPath), 'utf8');
        count = content ? content.split('\n').length : 0;
      } catch {
        count = 0;
      }
      files.push({ path: uPath, linesAdded: count, linesRemoved: 0 });
      totalAdded += count;
    }
  } catch {
    // Ignore untracked file error in numstat
  }

  return { files, totalAdded, totalRemoved };
}

export type DiffGateStatus =
  | 'CONFORMING'
  | 'VIOLATION'
  | 'INDETERMINATE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'NO_CHANGES';

export interface DiffGateCheck {
  ok: boolean;
  text: string;
  ruleId?: string;
  shapeIri?: string;
  property?: string;
  reference?: string;
}

export interface DiffGateResult {
  hasChanges: boolean;
  diffSummary: string;
  filesChanged: string[];
  fileStats?: { path: string; linesAdded: number; linesRemoved: number }[];
  linesAdded: number;
  linesRemoved: number;
  conforming: boolean;
  violations: string[];
  checks: DiffGateCheck[];
  gateStatus: DiffGateStatus;
  semanticStatus: 'CONFORMING' | 'VIOLATION' | 'INDETERMINATE' | 'VALIDATION_ERROR';
  shapeName: string;
  isPreliminary: true;
  scope: 'preliminary_workspace_diff';
  definitiveAuthorization: false;
  disclaimer: string;
  validationExecuted: boolean;
  requiresHumanReview: boolean;
  operations: string[];
  restrictions: string[];
  evidences: string[];
  reasons: string[];
  references: {
    evaluatingBaseCommit?: string;
    ontologyDigest?: string;
    rulesEvaluated?: string[];
  };
}

export async function evaluateWorkspaceDiffGate(options: {
  worktree: string;
  commitBase?: string;
  domainId?: string;
  projectRoot: string;
}): Promise<DiffGateResult> {
  const { worktree, commitBase, domainId, projectRoot } = options;
  const base = commitBase || 'HEAD';
  const disclaimer = 'Inspeção preliminar de workspace. Não constitui autorização definitiva de promoção nem substitui o gate de integração.';
  const defaultShapeName = domainId ? `${domainId.charAt(0).toUpperCase() + domainId.slice(1)}GovernanceShape` : 'WorkspaceSemanticShape';

  let diffArquivos: DiffArquivo[] = [];
  try {
    diffArquivos = await lerDiff(worktree, base);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      hasChanges: false,
      diffSummary: `Erro Git ao obter alterações: ${errorMsg}`,
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      conforming: false,
      violations: [`Erro Git: ${errorMsg}`],
      checks: [{ ok: false, text: `Erro Git ao inspecionar diff do workspace: ${errorMsg}` }],
      gateStatus: 'VALIDATION_ERROR',
      semanticStatus: 'VALIDATION_ERROR',
      shapeName: defaultShapeName,
      isPreliminary: true,
      scope: 'preliminary_workspace_diff',
      definitiveAuthorization: false,
      disclaimer,
      validationExecuted: false,
      requiresHumanReview: false,
      operations: [],
      restrictions: [],
      evidences: [],
      reasons: [`Erro Git: ${errorMsg}`],
      references: { evaluatingBaseCommit: base },
    };
  }

  if (diffArquivos.length === 0) {
    return {
      hasChanges: false,
      diffSummary: 'Nenhuma alteração detectada no workspace.',
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      conforming: true,
      violations: [],
      checks: [{ ok: true, text: 'Nenhuma alteração detectada no workspace' }],
      gateStatus: 'NO_CHANGES',
      semanticStatus: 'CONFORMING',
      shapeName: defaultShapeName,
      isPreliminary: true,
      scope: 'preliminary_workspace_diff',
      definitiveAuthorization: false,
      disclaimer,
      validationExecuted: false,
      requiresHumanReview: false,
      operations: [],
      restrictions: [],
      evidences: [],
      reasons: ['Nenhuma alteração detectada no workspace'],
      references: { evaluatingBaseCommit: base },
    };
  }

  const filesChanged = diffArquivos.map((d) => d.caminho);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const d of diffArquivos) {
    linesAdded += d.adicionadas.length;
    linesRemoved += d.removidas.length;
  }

  const fileStats = diffArquivos.map((d) => ({
    path: d.caminho,
    linesAdded: d.adicionadas.length,
    linesRemoved: d.removidas.length,
  }));

  const checks: DiffGateCheck[] = [];
  const violations: string[] = [];
  const operations: string[] = [];
  const restrictions: string[] = [];
  const evidences: string[] = [];
  const reasons: string[] = [];
  let validationExecuted = false;
  let requiresHumanReview = false;

  let snapshot: OntologySnapshot | null = null;
  try {
    snapshot = await createOntologySnapshot(projectRoot);
  } catch {
    snapshot = null;
  }

  if (!snapshot) {
    // Project without BSH configuration
    checks.push({
      ok: true,
      text: `Modificações concretas aplicadas (${filesChanged.length} arquivos, +${linesAdded} / -${linesRemoved} linhas)`,
    });
    checks.push({
      ok: true,
      text: 'Projeto sem configuração ontológica BSH (enforcement semântico não aplicável)',
    });
    return {
      hasChanges: true,
      diffSummary: `${filesChanged.length} arquivos modificados (+${linesAdded} / -${linesRemoved})`,
      filesChanged,
      fileStats,
      linesAdded,
      linesRemoved,
      conforming: true,
      violations: [],
      checks,
      gateStatus: 'CONFORMING',
      semanticStatus: 'CONFORMING',
      shapeName: defaultShapeName,
      isPreliminary: true,
      scope: 'preliminary_workspace_diff',
      definitiveAuthorization: false,
      disclaimer,
      validationExecuted: false,
      requiresHumanReview: false,
      operations: [],
      restrictions: [],
      evidences: [],
      reasons: ['Projeto sem configuração ontológica BSH'],
      references: { evaluatingBaseCommit: base },
    };
  }

  // Load rules from projectRoot (generic governance contract)
  let regras: RegraGovernanca[] = [];
  try {
    regras = await carregarRegrasGovernanca(projectRoot);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    checks.push({
      ok: false,
      text: `Falha na configuração de governança: ${errorMsg}`,
      reference: snapshot.digest,
    });
    reasons.push(`Falha de configuração de governança: ${errorMsg}`);
    return {
      hasChanges: true,
      diffSummary: `${filesChanged.length} arquivos modificados (+${linesAdded} / -${linesRemoved})`,
      filesChanged,
      fileStats,
      linesAdded,
      linesRemoved,
      conforming: false,
      violations: [errorMsg],
      checks,
      gateStatus: 'VALIDATION_ERROR',
      semanticStatus: 'VALIDATION_ERROR',
      shapeName: defaultShapeName,
      isPreliminary: true,
      scope: 'preliminary_workspace_diff',
      definitiveAuthorization: false,
      disclaimer,
      validationExecuted: false,
      requiresHumanReview: false,
      operations: [],
      restrictions: [],
      evidences: [],
      reasons,
      references: {
        evaluatingBaseCommit: base,
        ontologyDigest: snapshot.digest,
      },
    };
  }
  const operacoes = aplicarRegras(regras, diffArquivos);
  operations.push(...operacoes.map((o) => o.operacao));

  if (operacoes.length === 0) {
    // Diff has changes, but no semantic governance operation recognized
    // R3 FIX: DO NOT claim semantic validity when no operations or validation occurred
    checks.push({
      ok: false,
      text: 'Nenhuma operação semântica reconhecida para as alterações do diff',
      reference: snapshot.digest,
    });
    reasons.push('Nenhuma operação semântica reconhecida para as alterações do diff');
    return {
      hasChanges: true,
      diffSummary: `${filesChanged.length} arquivos modificados (+${linesAdded} / -${linesRemoved})`,
      filesChanged,
      fileStats,
      linesAdded,
      linesRemoved,
      conforming: false,
      violations: [],
      checks,
      gateStatus: 'INDETERMINATE',
      semanticStatus: 'INDETERMINATE',
      shapeName: defaultShapeName,
      isPreliminary: true,
      scope: 'preliminary_workspace_diff',
      definitiveAuthorization: false,
      disclaimer,
      validationExecuted: false,
      requiresHumanReview: false,
      operations: [],
      restrictions: [],
      evidences: [],
      reasons,
      references: {
        evaluatingBaseCommit: base,
        ontologyDigest: snapshot.digest,
        rulesEvaluated: regras.map((r) => r.id),
      },
    };
  }

  // Evaluate operations using canonical governance enforcement
  const lote = await avaliarOperacoes(projectRoot, snapshot, operacoes);
  for (const res of lote.resultados) {
    restrictions.push(...(res.selectedShapes ?? []));
    evidences.push(...(res.evidencia ?? []));
    if (res.validationExecuted) {
      validationExecuted = true;
    }
    if (res.requerRevisaoHumana) {
      requiresHumanReview = true;
    }

    if (res.status === 'violacao') {
      violations.push(...res.evidencia);
      checks.push({
        ok: false,
        text: `${res.operacao}: violação ontológica (${res.evidencia.join('; ')})`,
        ruleId: res.regra,
        shapeIri: res.shape,
        reference: snapshot.digest,
      });
      reasons.push(`Violação ontológica em ${res.operacao}: ${res.evidencia.join('; ')}`);
    } else if (res.status === 'revisao_humana') {
      checks.push({
        ok: false,
        text: `${res.operacao}: exige revisão humana vinculada ao candidato`,
        ruleId: res.regra,
        reference: snapshot.digest,
      });
      reasons.push(`Revisão humana necessária para ${res.operacao}`);
    } else if (res.status === 'indeterminado') {
      const reasonText = res.evidencia.some((e) => e.includes('semantic validation was not executed') || e.includes('No applicable SHACL'))
        ? `Operação '${res.operacao}': nenhuma shape executada; validade semântica não demonstrada`
        : `${res.operacao}: indeterminado (${res.evidencia.join('; ')})`;
      checks.push({
        ok: false,
        text: reasonText,
        ruleId: res.regra,
        reference: snapshot.digest,
      });
      reasons.push(`Validação indeterminada para ${res.operacao}`);
    } else if (res.status === 'conforme') {
      if (res.validationExecuted) {
        checks.push({
          ok: true,
          text: `Operação semântica '${res.operacao}' em conformidade SHACL (${(res.executedShapes ?? []).join(', ')})`,
          reference: snapshot.digest,
        });
      } else {
        // R3 FIX: no shapes executed -> do not claim demonstrated semantic validity
        checks.push({
          ok: false,
          text: `Operação '${res.operacao}': nenhuma shape executada; validade semântica não demonstrada`,
          reference: snapshot.digest,
        });
        reasons.push(`Validação semântica não executada para ${res.operacao}`);
      }
    }
  }

  // General code invariants check
  if (filesChanged.length > 0 && linesAdded > 0) {
    checks.push({
      ok: true,
      text: `Modificações concretas aplicadas (${filesChanged.length} arquivos, +${linesAdded} / -${linesRemoved} linhas)`,
    });
  }

  let gateStatus: DiffGateStatus = 'INDETERMINATE';
  let semanticStatus: DiffGateResult['semanticStatus'] = 'INDETERMINATE';

  if (violations.length > 0) {
    gateStatus = 'VIOLATION';
    semanticStatus = 'VIOLATION';
  } else if (requiresHumanReview) {
    gateStatus = 'HUMAN_REVIEW_REQUIRED';
    semanticStatus = 'INDETERMINATE';
  } else if (!validationExecuted || checks.some((c) => !c.ok)) {
    gateStatus = 'INDETERMINATE';
    semanticStatus = 'INDETERMINATE';
  } else {
    gateStatus = 'CONFORMING';
    semanticStatus = 'CONFORMING';
  }

  const conforming = gateStatus === 'CONFORMING';
  if (conforming) {
    reasons.push('Operações em conformidade com as shapes SHACL executadas');
  }

  return {
    hasChanges: true,
    diffSummary: `${filesChanged.length} arquivos modificados (+${linesAdded} / -${linesRemoved})`,
    filesChanged,
    fileStats,
    linesAdded,
    linesRemoved,
    conforming,
    violations,
    checks,
    gateStatus,
    semanticStatus,
    shapeName: restrictions[0] || defaultShapeName,
    isPreliminary: true,
    scope: 'preliminary_workspace_diff',
    definitiveAuthorization: false,
    disclaimer,
    validationExecuted,
    requiresHumanReview,
    operations: [...new Set(operations)],
    restrictions: [...new Set(restrictions)],
    evidences: [...new Set(evidences)],
    reasons: [...new Set(reasons)],
    references: {
      evaluatingBaseCommit: base,
      ontologyDigest: snapshot.digest,
      rulesEvaluated: operacoes.map((o) => o.regraId).filter(Boolean) as string[],
    },
  };
}
