import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadManifest } from '../../project/manifest.js';
import { createOntologySnapshot } from '../../ontology/query.js';
import { diagnoseCodexRuntime } from './doctor.js';
import { startGovernedAppServer } from './launcher.js';
import { createProjectBackup } from './snapshot.js';
import { finalizeSession } from './finalize.js';
import { instrumentSession, type SessionInstrumentation } from './instrumenter.js';
import { CodexRpcClient } from './rpc.js';

async function verifyGovernedMcp(client: CodexRpcClient, project: string): Promise<void> {
  const threadId = await client.startReadOnlyThread(project);
  try {
    await client.verifyOracleMcp(threadId);
  } finally {
    await client.unsubscribeThread(threadId).catch(() => undefined);
  }
}

function launchTerminalUi(server: { url: string; project: string; stateDirectory: string }): Promise<number> {
  const environment = { ...process.env, CODEX_HOME: server.stateDirectory };
  const child = spawn('codex', ['--remote', server.url], { cwd: server.project, env: environment, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });
}

export async function runCodexSession(root: string): Promise<void> {
  const report = await diagnoseCodexRuntime(root);
  if (!report.ready) throw new Error(`Sessão governada indisponível: ${report.reasons.join('; ')}`);
  const manifest = await loadManifest(root);
  const snapshot = await createOntologySnapshot(root);
  const domains = manifest.domains.map((domain) => domain.id);
  const server = await startGovernedAppServer(root, domains);
  const backupDirectory = join(server.stateDirectory, 'backup');
  await createProjectBackup(root, backupDirectory);
  const control = CodexRpcClient.connectWebSocket(server.url);
  control.nativeApprovalMode = 'ignore';
  control.on('stderr', (text: string) => process.stderr.write(text));
  control.on('ignoredServerRequest', (message: { method?: string }) => {
    process.stderr.write(`Oracle: solicitação nativa do Codex fora do fluxo mediado: ${String(message.method)}\n`);
  });
  control.on('protocolError', (error: Error) => process.stderr.write(`Oracle: ${error.message}\n`));
  let instrumentation: SessionInstrumentation | undefined;
  let cleaning = false;
  let terminalUiRunning = false;
  const cleanup = async (): Promise<void> => {
    if (cleaning) return;
    cleaning = true;
    instrumentation?.dispose();
    await control.closeAndWait().catch(() => undefined);
    await server.dispose().catch(() => undefined);
  };
  const onSignal = (code: number): void => {
    if (terminalUiRunning) return;
    void cleanup().finally(() => process.exit(code));
  };
  process.on('SIGINT', () => onSignal(130));
  process.on('SIGTERM', () => onSignal(143));
  try {
    await control.initialize();
    await control.verifyCleanConfiguration(server.project);
    await verifyGovernedMcp(control, server.project);
    instrumentation = await instrumentSession(control, root, server.project);
    process.stdout.write(`Oracle pronto. Abrindo a TUI do Codex no projeto real; o Oracle instrumenta a sessão, mede tokens e alerta violações de ontologia. Domínios: ${domains.join(', ')}.\n`);
    terminalUiRunning = true;
    const code = await launchTerminalUi(server);
    terminalUiRunning = false;
    process.stdout.write(`\nOracle: a TUI do Codex encerrou (código ${code}). Consolidando a sessão.\n`);
    await finalizeSession({
      root,
      backupDirectory,
      domain: manifest.domains.length === 1 ? manifest.domains[0].id : 'nao-classificado',
      snapshot,
      alerts: instrumentation.conflicts(),
      tokenTotals: instrumentation.tokenTotals(),
      ontologyQueries: instrumentation.ontologyQueries(),
      harnessTokens: instrumentation.harnessTokens(),
    });
  } finally {
    await cleanup();
  }
}