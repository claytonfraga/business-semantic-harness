import { loadManifest } from '../../project/manifest.js';
import { createOntologySnapshot } from '../../ontology/query.js';
import { validateProject } from '../../ontology/validate.js';
import { branchAtual, commitAtual, criarSessaoWorktree, finalizeSession, gravarSessao, resolverRepositorio } from '../../harness/index.js';
import { criarEstadoAgy, executarAgy } from './launcher.js';

function contextoOntologico(dominio: string): string {
  return `Projeto governado pelo Business Semantic Harness. Dominio: ${dominio}. Respeite as restricoes SHACL do projeto; se um pedido contrariar uma regra, nao implemente. Pedido do usuario: `;
}

/** Executa uma sessao Agy governada: worktree isolada, agy headless, enforcement no gate de promocao. */
export async function runAgySession(root: string, prompt: string, modelo?: string, esforco?: string): Promise<void> {
  const relatorio = await validateProject(root);
  if (!relatorio.ready) throw new Error(`Ontologia nao pronta: ${relatorio.issues.map((issue) => issue.message).join('; ')}`);
  const repositorioOrigem = await resolverRepositorio(root);
  const branchOrigem = await branchAtual(repositorioOrigem);
  const commitBase = await commitAtual(repositorioOrigem);
  const manifest = await loadManifest(repositorioOrigem);
  const dominio = manifest.domains[0]?.id ?? 'nao-classificado';
  const sessao = await criarSessaoWorktree({ repositorioOrigem, branchOrigem, commitBase });
  await gravarSessao(repositorioOrigem, sessao, 'WORKTREE_READY');
  const estado = await criarEstadoAgy();
  try {
    const textoTarefa = contextoOntologico(dominio) + prompt;
    process.stdout.write(`BSH/Agy: sessao ${sessao.id} na worktree ${sessao.caminhoWorktree}.\n`);
    const resultado = await executarAgy(estado, sessao.caminhoWorktree, textoTarefa, modelo, esforco);
    const snapshot = await createOntologySnapshot(repositorioOrigem);
    await finalizeSession({
      sessao, domain: dominio, snapshot, alerts: [],
      tokenTotals: resultado.tokens ? {
        inputTokens: resultado.tokens.entrada, outputTokens: resultado.tokens.saida,
        cachedInputTokens: resultado.tokens.cache, reasoningOutputTokens: resultado.tokens.raciocinio,
        totalTokens: resultado.tokens.totais,
      } : undefined,
      ontologyQueries: 0,
      harnessTokens: 0,
    });
  } finally {
    await estado.dispose();
  }
}
