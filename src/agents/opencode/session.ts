import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadManifest } from '../../project/manifest.js';
import { createOntologySnapshot } from '../../ontology/query.js';
import { hashConteudoCodigoBase } from '../../enforcement/codigoBase.js';
import { branchAtual, commitAtual, criarSessaoWorktree, finalizeSession, gravarSessao, resolverRepositorio } from '../../harness/index.js';
import type { TokenTotals } from '../../harness/index.js';
import {
  contarConsultasOntologia, criarEstadoOpencode, diagnoseOpencodeRuntime, executarOpencodePrompt,
  executarOpencodeTui, extrairTokensDaSaida, extrairTokensDoEstadoOpencode, lerAlertasOpencode,
  type OpencodeTokens,
} from './launcher.js';

export interface OpencodeSessionOptions {
  model?: string;
  consultative?: boolean;
  prompt?: string;
}

function paraTotais(tokens: OpencodeTokens | undefined): TokenTotals | undefined {
  if (!tokens) return undefined;
  return {
    inputTokens: tokens.entrada,
    outputTokens: tokens.saida,
    cachedInputTokens: tokens.cache,
    reasoningOutputTokens: tokens.raciocinio,
    totalTokens: tokens.totais,
  };
}

async function gravarInstrumentacao(
  root: string,
  consultas: number,
  conflitos: number,
  tokens: OpencodeTokens | undefined,
): Promise<void> {
  const diretorio = join(root, '.bsh', 'local');
  await mkdir(diretorio, { recursive: true });
  const arquivo = join(diretorio, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const linhas: string[] = [];
  for (let indice = 0; indice < consultas; indice += 1) {
    linhas.push(JSON.stringify({ event: 'item-completed', itemType: 'mcpToolCall', tool: 'bsh_query_ontology' }));
  }
  for (let indice = 0; indice < conflitos; indice += 1) {
    linhas.push(JSON.stringify({ event: 'item-completed', itemType: 'mcpToolCall', tool: 'bsh_report_conflict', conflict: true }));
  }
  linhas.push(JSON.stringify({ event: 'turn-completed', status: 'completed' }));
  if (tokens) {
    linhas.push(JSON.stringify({
      time: new Date().toISOString(), event: 'token-usage',
      inputTokens: tokens.entrada, outputTokens: tokens.saida, cachedInputTokens: tokens.cache,
      reasoningOutputTokens: tokens.raciocinio, totalTokens: tokens.totais,
    }));
  }
  await writeFile(arquivo, `${linhas.join('\n')}\n`, { mode: 0o600 });
}

/**
 * Sessão opencode governada pelo BSH: abre a TUI real (ou executa um prompt não-interativo)
 * numa worktree isolada, com o MCP de ontologia configurado, e aplica o mesmo gate do Codex
 * ao final (enforcement, gates, promoção Git). A instalação do opencode não é alterada.
 */
export async function runOpencodeSession(root: string, options: OpencodeSessionOptions = {}): Promise<void> {
  const model = options.model ?? process.env.BSH_OPENCODE_MODEL;
  const report = await diagnoseOpencodeRuntime(root);
  if (!report.ready) {
    throw new Error(`Sessão governada indisponível: ${report.reasons.join('; ')}`);
  }
  const repositorioOrigem = await resolverRepositorio(root);
  const branchOrigem = await branchAtual(repositorioOrigem);
  const commitBase = await commitAtual(repositorioOrigem);
  const incluirEstadoLocal = process.env.BSH_WORKTREE_INCLUDE_LOCAL === '1';
  const sessao = await criarSessaoWorktree({ repositorioOrigem, branchOrigem, commitBase, incluirEstadoLocal });
  const candidateInitialTreeHash = await hashConteudoCodigoBase(sessao.caminhoWorktree);
  await gravarSessao(repositorioOrigem, sessao, 'WORKTREE_READY');
  const manifest = await loadManifest(repositorioOrigem);
  const snapshot = await createOntologySnapshot(repositorioOrigem);
  const domains = manifest.domains.map((domain) => domain.id);
  const estado = await criarEstadoOpencode(repositorioOrigem, sessao.caminhoWorktree, domains, model, true, options.prompt === undefined);
  try {
    await gravarSessao(repositorioOrigem, sessao, 'AGENT_RUNNING');
    process.stdout.write(`BSH pronto. Sessao isolada: branch ${sessao.branchSessao} a partir de ${branchOrigem}@${commitBase.slice(0, 7)}; worktree ${sessao.caminhoWorktree}.\n`);
    process.stdout.write(`O opencode trabalha apenas na worktree; o BSH promove as alteracoes ao final. Modo: ${options.consultative ? 'consultivo' : 'governado'}. Dominios: ${domains.join(', ')}.\n`);

    let tokens: OpencodeTokens | undefined;
    if (options.prompt !== undefined) {
      process.stdout.write(`BSH/OpenCode: executando prompt nao-interativo${model ? ` (modelo: ${model})` : ''}; o BSH revisa as mudancas ao final.\n`);
      const resultado = await executarOpencodePrompt(estado, sessao.caminhoWorktree, options.prompt, model);
      tokens = extrairTokensDaSaida(resultado.saida) ?? await extrairTokensDoEstadoOpencode(estado);
      process.stdout.write(`\nBSH/OpenCode: execucao encerrou (código ${resultado.codigo}). Consolidando a sessão.\n`);
    } else {
      process.stdout.write(`BSH/OpenCode: abrindo a TUI real do opencode${model ? ` (modelo: ${model})` : ''}; o BSH revisa as mudancas ao sair.\n`);
      const codigo = await executarOpencodeTui(estado, sessao.caminhoWorktree, model);
      tokens = await extrairTokensDoEstadoOpencode(estado);
      process.stdout.write(`\nBSH/OpenCode: a TUI do opencode encerrou (código ${codigo}). Consolidando a sessão.\n`);
    }

    const alerts = await lerAlertasOpencode(estado);
    const ontologyQueries = await contarConsultasOntologia(estado);
    await gravarInstrumentacao(repositorioOrigem, ontologyQueries, alerts.length, tokens);
    const tokenTotals = paraTotais(tokens);

    await finalizeSession({
      sessao,
      domain: manifest.domains.length === 1 ? manifest.domains[0].id : 'nao-classificado',
      snapshot,
      alerts,
      tokenTotals,
      ontologyQueries,
      harnessTokens: 0,
      consultative: options.consultative === true,
      // No modo não-interativo não há TUI para responder; a exceção é negada por padrão.
      confirmar: options.prompt !== undefined ? async () => false : undefined,
      candidateInitialTreeHash,
    });
  } finally {
    await estado.dispose();
  }
}
