import { spawn } from 'node:child_process';
import { loadManifest } from '../../project/manifest.js';
import { createOntologySnapshot } from '../../ontology/query.js';
import { diagnoseCodexRuntime } from './doctor.js';
import { startGovernedAppServer } from './launcher.js';
import { finalizeSession } from './finalize.js';
import { instrumentSession, type SessionInstrumentation } from './instrumenter.js';
import { CodexRpcClient } from './rpc.js';
import { branchAtual, commitAtual, criarSessaoWorktree, resolverRepositorio } from './worktree.js';
import { gravarSessao } from './sessionState.js';

async function verifyGovernedMcp(client: CodexRpcClient, repositorioOrigem: string): Promise<void> {
  const threadId = await client.startReadOnlyThread(repositorioOrigem);
  try {
    await client.verifyBSHMcp(threadId);
  } finally {
    await client.unsubscribeThread(threadId).catch(() => undefined);
  }
}

function launchTerminalUi(server: { url: string; workspaceSessao: string; stateDirectory: string }): Promise<number> {
  const environment = { ...process.env, CODEX_HOME: server.stateDirectory };
  const child = spawn('codex', ['--remote', server.url], { cwd: server.workspaceSessao, env: environment, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });
}

export async function runCodexSession(root: string, options: { consultative?: boolean } = {}): Promise<void> {
  const report = await diagnoseCodexRuntime(root);
  if (!report.ready) throw new Error(`Sessão governada indisponível: ${report.reasons.join('; ')}`);
  const repositorioOrigem = await resolverRepositorio(root);
  const branchOrigem = await branchAtual(repositorioOrigem);
  const commitBase = await commitAtual(repositorioOrigem);
  const incluirEstadoLocal = process.env.BSH_WORKTREE_INCLUDE_LOCAL === '1';
  const sessao = await criarSessaoWorktree({ repositorioOrigem, branchOrigem, commitBase, incluirEstadoLocal });
  await gravarSessao(repositorioOrigem, sessao, 'WORKTREE_READY');
  const manifest = await loadManifest(repositorioOrigem);
  const snapshot = await createOntologySnapshot(repositorioOrigem);
  const domains = manifest.domains.map((domain) => domain.id);
  const server = await startGovernedAppServer({ repositorioOrigem, workspaceSessao: sessao.caminhoWorktree, domains });
  const control = CodexRpcClient.connectWebSocket(server.url);
  control.nativeApprovalMode = 'ignore';
  control.on('stderr', (text: string) => process.stderr.write(text));
  control.on('ignoredServerRequest', (message: { method?: string }) => {
    process.stderr.write(`BSH: solicitação nativa do Codex fora do fluxo mediado: ${String(message.method)}\n`);
  });
  control.on('protocolError', (error: Error) => process.stderr.write(`BSH: ${error.message}\n`));
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
    await control.verifyCleanConfiguration(sessao.caminhoWorktree);
    await verifyGovernedMcp(control, repositorioOrigem);
    instrumentation = await instrumentSession(control, repositorioOrigem, sessao.caminhoWorktree);
    await gravarSessao(repositorioOrigem, sessao, 'AGENT_RUNNING');
    process.stdout.write(`BSH pronto. Sessao isolada: branch ${sessao.branchSessao} a partir de ${branchOrigem}@${commitBase.slice(0, 7)}; worktree ${sessao.caminhoWorktree}.\n`);
    process.stdout.write(`O Codex trabalha apenas na worktree; o BSH promove as alteracoes ao final. Modo: ${options.consultative ? 'consultivo' : 'governado'}. Dominios: ${domains.join(', ')}.\n`);
    terminalUiRunning = true;
    const code = await launchTerminalUi(server);
    terminalUiRunning = false;
    process.stdout.write(`\nBSH: a TUI do Codex encerrou (código ${code}). Consolidando a sessão.\n`);
    await finalizeSession({
      sessao,
      domain: manifest.domains.length === 1 ? manifest.domains[0].id : 'nao-classificado',
      snapshot,
      alerts: instrumentation.conflicts(),
      tokenTotals: instrumentation.tokenTotals(),
      ontologyQueries: instrumentation.ontologyQueries(),
      harnessTokens: instrumentation.harnessTokens(),
      consultative: options.consultative === true,
    });
  } finally {
    await cleanup();
  }
}
