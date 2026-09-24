import { execFile, spawn } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { countLines, readConflictAlerts, type ConflictAlert } from '../../harness/index.js';
import { validateProject } from '../../ontology/validate.js';

const execFileAsync = promisify(execFile);

export interface EstadoAgy {
  diretorio: string;
  sessaoDir: string;
  dispose(): Promise<void>;
}

export interface AgyRuntimeReport {
  ready: boolean;
  agyVersion?: string;
  reasons: string[];
}

export interface AgyDoctorReport extends AgyRuntimeReport {
  ontologyReady: boolean;
  mcpEntrypointReady: boolean;
}

export async function diagnoseAgyRuntime(root: string): Promise<AgyRuntimeReport> {
  const reasons: string[] = [];
  let agyVersion: string | undefined;
  try {
    const result = await execFileAsync('agy', ['--version'], { timeout: 5_000 });
    agyVersion = result.stdout.trim();
  } catch {
    reasons.push('Agy CLI indisponível');
  }
  const ontology = await validateProject(root);
  if (!ontology.ready) reasons.push(...ontology.issues.map((issue) => `${issue.domain}: ${issue.message}`));
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
  } catch {
    reasons.push('Servidor MCP BSH não compilado');
  }
  try {
    await access(join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'));
  } catch {
    reasons.push('Token de autenticação do Agy ausente (~/.gemini/antigravity-cli/antigravity-oauth-token)');
  }
  return { ready: reasons.length === 0, agyVersion, reasons };
}

export async function diagnoseAgy(root: string): Promise<AgyDoctorReport> {
  const runtime = await diagnoseAgyRuntime(root);
  const ontology = await validateProject(root);
  let mcpEntrypointReady = false;
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
    mcpEntrypointReady = true;
  } catch {
    // motivo já registrado em runtime.reasons
  }
  return {
    ...runtime,
    ontologyReady: ontology.ready,
    mcpEntrypointReady,
  };
}

function buildGovernedAgyInstructions(domains: string[]): string {
  const list = domains.length > 0 ? domains.join(', ') : 'não declarados';
  return [
    '# Sessão governada pelo BSH',
    '',
    'Este projeto é governado pelo BSH. Você trabalha em uma worktree Git isolada da sessão.',
    'Sempre comece consultando a ontologia do domínio com a ferramenta MCP `bsh_query_ontology`, mesmo que o pedido pareça simples, e antes de implementar qualquer mudança.',
    `Domínios declarados: ${list}.`,
    'Se um pedido contrariar a ontologia, chame `bsh_report_conflict` e aguarde a decisão humana; não contorne essa decisão.',
    'O BSH mede as consultas ontológicas e alerta o humano em caso de violação.',
    'O checkout principal permanece intacto; o BSH promove as alterações após a validação.',
    '',
  ].join('\n');
}

/**
 * HOME privado com cópia de credenciais e configuração isolada do agy.
 * Nunca altera nem polui a instalação real do usuário em ~/.gemini.
 */
export async function criarEstadoAgy(
  repositorioOrigem: string,
  workspaceSessao: string,
  domains: string[] = [],
  model?: string,
): Promise<EstadoAgy> {
  const diretorio = await mkdtemp(join(tmpdir(), 'bsh-agy-home-'));
  await chmod(diretorio, 0o700);
  const sessaoDir = join(diretorio, '.bsh-session');
  await mkdir(sessaoDir, { recursive: true, mode: 0o700 });

  const geminiDir = join(diretorio, '.gemini');
  const agyDir = join(geminiDir, 'antigravity-cli');
  const configDir = join(geminiDir, 'config');
  const cacheDir = join(agyDir, 'cache');
  await mkdir(agyDir, { recursive: true, mode: 0o700 });
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });

  const realGemini = join(homedir(), '.gemini');
  const realAgy = join(realGemini, 'antigravity-cli');

  for (const arquivo of ['oauth_creds.json', 'google_accounts.json', 'google_account_id', 'installation_id', 'state.json']) {
    try {
      await copyFile(join(realGemini, arquivo), join(geminiDir, arquivo));
      await chmod(join(geminiDir, arquivo), 0o600);
    } catch {
      // arquivo opcional ou ausente
    }
  }
  for (const arquivo of ['antigravity-oauth-token', 'installation_id', 'jetski_state.pbtxt']) {
    try {
      await copyFile(join(realAgy, arquivo), join(agyDir, arquivo));
      await chmod(join(agyDir, arquivo), 0o600);
    } catch {
      // arquivo opcional ou ausente
    }
  }

  // Pré-confiança da worktree isolada para a TUI do agy não pedir confirmação
  const trustedFolders = { [workspaceSessao]: 'TRUST_FOLDER' };
  await writeFile(join(geminiDir, 'trustedFolders.json'), JSON.stringify(trustedFolders, null, 2), { mode: 0o600 });

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(join(realAgy, 'settings.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // usa padrão vazio
  }
  const confiaveis = Array.isArray(settings.trustedWorkspaces) ? (settings.trustedWorkspaces as string[]) : [];
  if (!confiaveis.includes(workspaceSessao)) confiaveis.push(workspaceSessao);
  settings.trustedWorkspaces = confiaveis;
  const permissions = (settings.permissions && typeof settings.permissions === 'object'
    ? settings.permissions
    : { allow: [] }) as { allow?: string[] };
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  if (!allow.includes('mcp(bsh/*)')) allow.push('mcp(bsh/*)');
  permissions.allow = allow;
  settings.permissions = permissions;
  await writeFile(join(agyDir, 'settings.json'), JSON.stringify(settings, null, 2), { mode: 0o600 });

  // Configuração global da UI para não solicitar tema na inicialização
  let geminiSettings: Record<string, unknown> = {};
  try {
    geminiSettings = JSON.parse(await readFile(join(realGemini, 'settings.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // usa padrão
  }
  if (!geminiSettings.ui || typeof geminiSettings.ui !== 'object') {
    geminiSettings.ui = { theme: 'Default' };
  } else {
    const ui = geminiSettings.ui as Record<string, unknown>;
    if (!ui.theme) ui.theme = 'Default';
  }
  if (model) {
    const modelConfig = (geminiSettings.model && typeof geminiSettings.model === 'object'
      ? { ...(geminiSettings.model as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    modelConfig.name = model;
    geminiSettings.model = modelConfig;
  }
  await writeFile(join(geminiDir, 'settings.json'), JSON.stringify(geminiSettings, null, 2), { mode: 0o600 });

  // Sinalização de onboarding completo e migração concluída para evitar assistente interativo de boas-vindas
  await writeFile(
    join(cacheDir, 'onboarding.json'),
    JSON.stringify({ consumerOnboardingComplete: true, enterpriseOnboardingComplete: false, onboardingComplete: true }, null, 2),
    { mode: 0o600 },
  );
  await writeFile(join(configDir, '.migrated'), '', { mode: 0o600 });
  try {
    await copyFile(join(realGemini, 'config', 'config.json'), join(configDir, 'config.json'));
    await chmod(join(configDir, 'config.json'), 0o600);
  } catch {
    // arquivo opcional
  }

  // Configuração direta do MCP de ontologia do BSH
  const mcpEntrypoint = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
  const mcpConfig = {
    mcpServers: {
      bsh: {
        command: process.execPath,
        args: [mcpEntrypoint, repositorioOrigem, 'governed'],
        env: {
          BSH_SESSION_DIR: sessaoDir,
        },
        disabled: false,
      },
    },
  };
  await writeFile(join(configDir, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2), { mode: 0o600 });

  // Injeção de instruções de governança
  await writeFile(join(geminiDir, 'GEMINI.md'), buildGovernedAgyInstructions(domains), { mode: 0o600 });

  return {
    diretorio,
    sessaoDir,
    async dispose() {
      await rm(diretorio, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Abre a TUI real do agy na worktree (herda o terminal), como o BSH faz com o Codex. */
export function executarAgyTui(
  estado: EstadoAgy,
  workspace: string,
  model?: string,
): Promise<number> {
  const args = ['--dangerously-skip-permissions'];
  if (model) args.push('--model', model);
  const filho = spawn('agy', args, {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: estado.diretorio,
      BSH_SESSION_DIR: estado.sessaoDir,
    },
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    filho.once('error', reject);
    filho.once('exit', (codigo) => resolve(codigo ?? 0));
  });
}

export async function lerAlertasAgy(estado: EstadoAgy): Promise<ConflictAlert[]> {
  return readConflictAlerts(join(estado.sessaoDir, 'alerts.jsonl'));
}

export async function contarConsultasOntologia(estado: EstadoAgy): Promise<number> {
  return countLines(join(estado.sessaoDir, 'ontology-queries.jsonl'));
}

export interface ResultadoAgy {
  tokens: { entrada: number; saida: number; cache: number; raciocinio: number; totais: number } | undefined;
}

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

/** Extrai tokens do JSON do agy; campos observados: input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens. */
export function extrairTokens(saida: string): ResultadoAgy['tokens'] {
  for (const linha of saida.split('\n').reverse()) {
    const texto = linha.trim();
    if (!texto.startsWith('{')) continue;
    try {
      const evento = JSON.parse(texto) as Record<string, unknown>;
      const usage = (evento.usage ?? evento.tokens) as Record<string, unknown> | undefined;
      if (usage) {
        const entrada = numero(usage.input_tokens);
        const saidaTokens = numero(usage.output_tokens);
        const total = numero(usage.total_tokens) || entrada + saidaTokens;
        if (total === 0) return undefined;
        return { entrada, saida: saidaTokens, cache: numero(usage.cache_read_tokens), raciocinio: numero(usage.thinking_tokens), totais: total };
      }
    } catch {
      // linha não-JSON
    }
  }
  return undefined;
}
