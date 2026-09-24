import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, chmod } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const GEMINI_DIRECTORY = join(homedir(), '.gemini');
const AGY_DIRECTORY = join(GEMINI_DIRECTORY, 'antigravity-cli');

export interface EstadoAgy {
  diretorio: string;
  dispose(): Promise<void>;
}

/** Cria um GEMINI_DIR privado e copia o token de autenticacao do agy. Nao altera a instalacao do agy. */
export async function criarEstadoAgy(): Promise<EstadoAgy> {
  const diretorio = await mkdtemp(join(tmpdir(), 'bsh-agy-state-'));
  await chmod(diretorio, 0o700);
  const destino = join(diretorio, 'antigravity-cli');
  await mkdir(destino, { recursive: true, mode: 0o700 });
  for (const arquivo of ['antigravity-oauth-token', 'antigravity-config.json']) {
    try {
      await copyFile(join(AGY_DIRECTORY, arquivo), join(destino, arquivo));
      await chmod(join(destino, arquivo), 0o600);
    } catch {
      // ausente
    }
  }
  return { diretorio, async dispose() { await import('node:fs/promises').then((fs) => fs.rm(diretorio, { recursive: true, force: true })); } };
}

export interface ResultadoAgy {
  tokens: { entrada: number; saida: number; cache: number; raciocinio: number; totais: number } | undefined;
  saida: string;
  codigo: number;
}

/** Executa um pedido headless (`agy --print`) dentro da worktree, com config isolada. */
export function executarAgy(estado: EstadoAgy, workspace: string, prompt: string, modelo?: string, esforco?: string): Promise<ResultadoAgy> {
  const args = ['--print', '--output-format', 'json', '--dangerously-skip-permissions'];
  if (modelo) args.push('--model', modelo);
  if (esforco) args.push('--effort', esforco);
  args.push(prompt);
  const environment: NodeJS.ProcessEnv = { ...process.env, GEMINI_DIR: estado.diretorio };
  return new Promise((resolve, reject) => {
    const filho = spawn('agy', args, { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    filho.stdout.on('data', (chunk: Buffer) => { saida += chunk.toString('utf8'); });
    filho.on('error', reject);
    filho.on('exit', (codigo) => resolve({ tokens: extrairTokens(saida), saida, codigo: codigo ?? 0 }));
  });
}

function numero(valor: unknown): number { return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0; }

/** Extrai tokens do JSON do agy quando disponivel; retorna undefined quando o formato nao for observavel. */
export function extrairTokens(saida: string): ResultadoAgy['tokens'] {
  for (const linha of saida.split('\n').reverse()) {
    const texto = linha.trim();
    if (!texto.startsWith('{')) continue;
    try {
      const evento = JSON.parse(texto) as Record<string, unknown>;
      const usage = (evento.usage ?? evento.tokens ?? (evento.result as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
      if (usage) {
        const entrada = numero(usage.input_tokens ?? usage.inputTokens);
        const saida = numero(usage.output_tokens ?? usage.outputTokens);
        return { entrada, saida, cache: numero(usage.cached_input_tokens ?? usage.cachedInputTokens), raciocinio: numero(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens), totais: entrada + saida };
      }
    } catch { /* linha nao-JSON */ }
  }
  return undefined;
}
