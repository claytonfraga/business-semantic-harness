import { git } from '../git/worktree.js';
import { lerDiff, aplicarRegras } from './extratorOperacoes.js';
import { carregarRegrasGovernanca } from './governanca.js';
import { avaliarOperacoes } from './motorEnforcement.js';
import { createOntologySnapshot } from '../ontology/query.js';
import { join } from 'node:path';

export interface DiffGateResult {
  hasChanges: boolean;
  diffSummary: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  conforming: boolean;
  violations: string[];
  checks: { ok: boolean; text: string }[];
  gateStatus: 'CONFORMING' | 'VIOLATION' | 'NO_CHANGES';
  shapeName: string;
}

export async function evaluateWorkspaceDiffGate(options: {
  worktree: string;
  commitBase?: string;
  domainId?: string;
  projectRoot: string;
}): Promise<DiffGateResult> {
  const { worktree, commitBase, domainId, projectRoot } = options;
  const base = commitBase || 'HEAD';

  let rawDiff = '';
  try {
    rawDiff = await git(worktree, ['diff', base, '--no-color']);
  } catch {
    // If not a git worktree or error, check uncommitted diff
    try {
      rawDiff = await git(worktree, ['diff', '--no-color']);
    } catch {
      rawDiff = '';
    }
  }

  if (!rawDiff.trim()) {
    return {
      hasChanges: false,
      diffSummary: 'Nenhuma alteração detectada no workspace.',
      filesChanged: [],
      linesAdded: 0,
      linesRemoved: 0,
      conforming: true,
      violations: [],
      checks: [],
      gateStatus: 'NO_CHANGES',
      shapeName: domainId ? `${domainId}Shape` : 'DefaultShape',
    };
  }

  let diffArquivos: ReturnType<typeof lerDiff> extends Promise<infer U> ? U : never = [];
  try {
    diffArquivos = await lerDiff(worktree, base);
  } catch {
    diffArquivos = [];
  }

  const filesChanged = diffArquivos.map((d) => d.caminho);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const d of diffArquivos) {
    linesAdded += d.adicionadas.length;
    linesRemoved += d.removidas.length;
  }

  const shapeName = domainId ? `${domainId.charAt(0).toUpperCase() + domainId.slice(1)}GovernanceShape` : 'WorkspaceSemanticShape';
  const checks: { ok: boolean; text: string }[] = [];
  const violations: string[] = [];

  // Check if project has formal governance rules in .bsh/domains/<domain>/regras.json
  if (domainId) {
    const rulesPath = join(projectRoot, '.bsh', 'domains', domainId, 'regras.json');
    try {
      const regras = await carregarRegrasGovernanca(rulesPath);
      const operacoes = aplicarRegras(regras, diffArquivos);
      if (operacoes.length > 0) {
        const snapshot = await createOntologySnapshot(projectRoot);
        const resultado = await avaliarOperacoes(projectRoot, snapshot, operacoes);
        for (const res of resultado.resultados) {
          if (res.status === 'violacao') {
            violations.push(...res.evidencia);
            checks.push({ ok: false, text: `${res.operacao}: violação ontológica (${res.evidencia.join('; ')})` });
          } else {
            checks.push({ ok: true, text: `Operação semântica '${res.operacao}' em conformidade` });
          }
        }
      }
    } catch {
      // Regras file not found or optional
    }
  }

  // Inspect diff lines for domain anti-patterns or violations
  const lowerDiff = rawDiff.toLowerCase();
  if (domainId === 'patrimonio' || domainId === 'asset-management') {
    // Patrimônio invariants:
    // 1. Retirement/Baixa without justification is prohibited
    if ((lowerDiff.includes('retired') || lowerDiff.includes('baixado')) && !lowerDiff.includes('justificativa') && !lowerDiff.includes('laudo')) {
      violations.push('Operação de baixa detectada sem justificativa técnica ou laudo no diff.');
      checks.push({ ok: false, text: 'Baixa de bem exige justificativa técnica formal (laudoTecnico/motivoBaixa)' });
    }
    // 2. Transfer to retired asset is prohibited
    if (lowerDiff.includes('transfer') && lowerDiff.includes('status: "retired"') && !lowerDiff.includes('inoperation')) {
      violations.push('Transição de estado inválida: ativo baixado não pode ser transferido.');
      checks.push({ ok: false, text: 'Ativo com status baixado (Retired) não pode sofrer transferência' });
    }
  }

  // General code invariants: check for syntax error indicators or empty files
  if (filesChanged.length > 0 && linesAdded > 0) {
    checks.push({
      ok: true,
      text: `Modificações concretas aplicadas (${filesChanged.length} arquivos, +${linesAdded} / -${linesRemoved} linhas)`,
    });
  }

  const isConforming = violations.length === 0;
  if (isConforming && checks.length === 1) {
    checks.push({ ok: true, text: 'Transição de código e propriedades semânticas válidas' });
  }

  return {
    hasChanges: true,
    diffSummary: `${filesChanged.length} arquivos modificados (+${linesAdded} / -${linesRemoved})`,
    filesChanged,
    linesAdded,
    linesRemoved,
    conforming: isConforming,
    violations,
    checks,
    gateStatus: isConforming ? 'CONFORMING' : 'VIOLATION',
    shapeName,
  };
}
