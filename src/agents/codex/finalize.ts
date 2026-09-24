import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { appendAudit } from '../../decision/audit.js';
import { actionDigest, evaluateAction, type ProposedAction } from '../../decision/evaluate.js';
import type { OntologySnapshot } from '../../ontology/query.js';
import { writeAlerts, type ConflictAlert } from './alerts.js';
import { collectChangedPaths, restoreFile, type FileChange } from './snapshot.js';
import { formatSavingsReport, formatUsageReport, type SavingsReport, type TokenTotals } from './usage.js';

export interface FinalizeOptions {
  root: string;
  backupDirectory: string;
  domain: string;
  snapshot: OntologySnapshot;
  alerts: ConflictAlert[];
  tokenTotals: TokenTotals | undefined;
  ontologyQueries: number;
  harnessTokens: number;
  savings?: SavingsReport;
}

function buildAction(domain: string, change: FileChange): ProposedAction {
  return {
    id: randomUUID(),
    tool: 'codex_native_edit',
    domain,
    arguments: { path: change.path, existedBefore: change.existedBefore },
    mutates: true,
    intercepted: false,
    representation: 'partial',
  };
}

async function auditChange(
  root: string,
  domain: string,
  change: FileChange,
  snapshot: OntologySnapshot,
  decision: 'allow' | 'deny',
  actor: string,
  reason: string,
): Promise<void> {
  const action = buildAction(domain, change);
  const evaluation = await evaluateAction(root, action, snapshot);
  await appendAudit(root, {
    time: new Date().toISOString(),
    actionId: action.id,
    domain,
    actionDigest: actionDigest(action, snapshot.digest),
    snapshotDigest: snapshot.digest,
    rules: evaluation.rules,
    evaluation: evaluation.status,
    confidence: evaluation.confidence,
    decision,
    actor,
    reason,
  });
}

async function confirmException(): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question('Aprovar excecao e manter as alteracoes no projeto? [s/N] ')).trim().toLowerCase();
    return answer === 's' || answer === 'sim';
  } finally {
    terminal.close();
  }
}

export async function finalizeSession(options: FinalizeOptions): Promise<{ kept: number; reverted: number }> {
  const { root, backupDirectory, domain, snapshot, alerts, tokenTotals, ontologyQueries, harnessTokens, savings } = options;
  process.stdout.write(`\n${formatUsageReport(tokenTotals, ontologyQueries, alerts.length, harnessTokens)}\n`);
  if (savings) process.stdout.write(`${formatSavingsReport(savings)}\n`);
  if (alerts.length > 0) {
    const sessionId = randomUUID();
    const alertsFile = await writeAlerts(root, sessionId, alerts);
    process.stdout.write(`\nALERTA: a sessao contrariou ou nao confirmou a ontologia. Registrado em ${alertsFile}.\n`);
    for (const alert of alerts) {
      process.stdout.write(`  - [${alert.domain}] ${alert.reason} | regras: ${alert.conflictingRules.join('; ')}\n`);
    }
  }
  const changes = await collectChangedPaths(root, backupDirectory);
  if (changes.length === 0 && alerts.length === 0) {
    process.stdout.write('Oracle: nenhuma alteracao do Codex no projeto.\n');
    return { kept: 0, reverted: 0 };
  }
  if (changes.length > 0) {
    process.stdout.write(`Oracle: ${changes.length} arquivo(s) alterado(s): ${changes.map((change) => change.path).join(', ')}\n`);
  }
  if (alerts.length === 0) {
    process.stdout.write('Oracle: ontologia respeitada na sessao (sem conflitos relatados); alteracoes mantidas.\n');
    for (const change of changes) {
      await auditChange(root, domain, change, snapshot, 'allow', 'oracle-harness', 'Ontologia respeitada: nenhum conflito relatado na sessao');
    }
    return { kept: changes.length, reverted: 0 };
  }
  const approved = await confirmException();
  if (approved) {
    for (const change of changes) {
      await auditChange(root, domain, change, snapshot, 'allow', 'local-user', 'Excecao aprovada pelo usuario');
    }
    process.stdout.write('Oracle: excecao aprovada; alteracoes mantidas.\n');
    return { kept: changes.length, reverted: 0 };
  }
  for (const change of changes) {
    await restoreFile(root, backupDirectory, change);
    await auditChange(root, domain, change, snapshot, 'deny', 'local-user', 'Excecao negada pelo usuario');
  }
  process.stdout.write(`Oracle: excecao negada; ${changes.length} alteracao(oes) revertida(s) no projeto.\n`);
  process.stdout.write('Oracle: aguardando a resposta do Codex e encerrando o teste E2E em 10 segundos...\n');
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  process.stdout.write('Oracle: teste E2E encerrado.\n');
  return { kept: 0, reverted: changes.length };
}