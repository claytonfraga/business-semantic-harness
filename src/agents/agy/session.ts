import { loadManifest } from '../../project/manifest.js';
import { createOntologySnapshot } from '../../ontology/query.js';
import { branchAtual, commitAtual, criarSessaoWorktree, finalizeSession, gravarSessao, resolverRepositorio } from '../../harness/index.js';
import { contarConsultasOntologia, criarEstadoAgy, diagnoseAgyRuntime, executarAgyTui, lerAlertasAgy } from './launcher.js';

export interface AgySessionOptions {
  model?: string;
}

/**
 * Sessão Agy governada: abre a TUI real do agy numa worktree isolada, com o MCP de
 * ontologia configurado, e aplica o mesmo gate do Codex ao final (enforcement, gates,
 * promoção Git). A instalação do agy não é alterada (HOME privado).
 */
export async function runAgySession(root: string, options: AgySessionOptions = {}): Promise<void> {
  const model = options.model ?? process.env.BSH_AGY_MODEL;
  const report = await diagnoseAgyRuntime(root);
  if (!report.ready) {
    throw new Error(`Sessão governada indisponível: ${report.reasons.join('; ')}`);
  }
  const repositorioOrigem = await resolverRepositorio(root);
  const branchOrigem = await branchAtual(repositorioOrigem);
  const commitBase = await commitAtual(repositorioOrigem);
  const incluirEstadoLocal = process.env.BSH_WORKTREE_INCLUDE_LOCAL === '1';
  const sessao = await criarSessaoWorktree({ repositorioOrigem, branchOrigem, commitBase, incluirEstadoLocal });
  await gravarSessao(repositorioOrigem, sessao, 'WORKTREE_READY');
  const manifest = await loadManifest(repositorioOrigem);
  const snapshot = await createOntologySnapshot(repositorioOrigem);
  const domains = manifest.domains.map((domain) => domain.id);
  const estado = await criarEstadoAgy(repositorioOrigem, sessao.caminhoWorktree, domains, model);
  try {
    await gravarSessao(repositorioOrigem, sessao, 'AGENT_RUNNING');
    process.stdout.write(`BSH pronto. Sessao isolada: branch ${sessao.branchSessao} a partir de ${branchOrigem}@${commitBase.slice(0, 7)}; worktree ${sessao.caminhoWorktree}.\n`);
    process.stdout.write(`O Agy trabalha apenas na worktree; o BSH promove as alteracoes ao final. Dominios: ${domains.join(', ')}.\n`);
    process.stdout.write(`BSH/Agy: abrindo a TUI real do agy${model ? ` (modelo: ${model})` : ''}; o BSH revisa as mudancas ao sair.\n`);
    const codigo = await executarAgyTui(estado, sessao.caminhoWorktree, model);
    process.stdout.write(`\nBSH/Agy: a TUI do agy encerrou (código ${codigo}). Consolidando a sessão.\n`);
    const alerts = await lerAlertasAgy(estado);
    const ontologyQueries = await contarConsultasOntologia(estado);
    await finalizeSession({
      sessao,
      domain: manifest.domains.length === 1 ? manifest.domains[0].id : 'nao-classificado',
      snapshot,
      alerts,
      tokenTotals: undefined,
      ontologyQueries,
      harnessTokens: 0,
    });
  } finally {
    await estado.dispose();
  }
}
