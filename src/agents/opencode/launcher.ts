import { execFile, spawn } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { countLines, readConflictAlerts, type ConflictAlert } from '../../harness/index.js';
import { validateProject } from '../../ontology/validate.js';

const execFileAsync = promisify(execFile);

const OPENCODE_CONFIG_DIRECTORY = join(homedir(), '.config', 'opencode');
const OPENCODE_DATA_DIRECTORY = join(homedir(), '.local', 'share', 'opencode');

export interface EstadoOpencode {
  diretorio: string;
  sessaoDir: string;
  dispose(): Promise<void>;
}

export interface OpencodeRuntimeReport {
  ready: boolean;
  opencodeVersion?: string;
  reasons: string[];
}

export interface OpencodeDoctorReport extends OpencodeRuntimeReport {
  ontologyReady: boolean;
  mcpEntrypointReady: boolean;
}

export interface OpencodeTokens {
  entrada: number;
  saida: number;
  cache: number;
  raciocinio: number;
  totais: number;
}

export async function diagnoseOpencodeRuntime(root: string): Promise<OpencodeRuntimeReport> {
  const reasons: string[] = [];
  let opencodeVersion: string | undefined;
  try {
    const result = await execFileAsync('opencode', ['--version'], { timeout: 5_000 });
    opencodeVersion = result.stdout.trim();
  } catch {
    reasons.push('opencode CLI indisponível');
  }
  const ontology = await validateProject(root);
  if (!ontology.ready) reasons.push(...ontology.issues.map((issue) => `${issue.domain}: ${issue.message}`));
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
  } catch {
    reasons.push('Servidor MCP BSH não compilado');
  }
  try {
    await access(join(OPENCODE_DATA_DIRECTORY, 'auth.json'));
  } catch {
    reasons.push(`Credenciais do opencode ausentes (${join(OPENCODE_DATA_DIRECTORY, 'auth.json')})`);
  }
  return { ready: reasons.length === 0, opencodeVersion, reasons };
}

export async function diagnoseOpencode(root: string): Promise<OpencodeDoctorReport> {
  const runtime = await diagnoseOpencodeRuntime(root);
  const ontology = await validateProject(root);
  let mcpEntrypointReady = false;
  try {
    await access(fileURLToPath(new URL('../../mcp/server.js', import.meta.url)));
    mcpEntrypointReady = true;
  } catch {
    // motivo já registrado em runtime.reasons
  }
  return { ...runtime, ontologyReady: ontology.ready, mcpEntrypointReady };
}

function buildGovernedOpencodeInstructions(domains: string[]): string {
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

function opencodeEnvironment(estado: EstadoOpencode): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: estado.diretorio,
    XDG_CONFIG_HOME: join(estado.diretorio, '.config'),
    XDG_DATA_HOME: join(estado.diretorio, '.local', 'share'),
    XDG_CACHE_HOME: join(estado.diretorio, '.cache'),
    XDG_STATE_HOME: join(estado.diretorio, '.local', 'state'),
    BSH_SESSION_DIR: estado.sessaoDir,
  };
}

export interface OpencodeConfigInput {
  mcpEntrypoint: string;
  repositorioOrigem: string;
  sessaoDir: string;
  instructionsPath: string;
  model?: string;
  governed: boolean;
  interactive?: boolean;
}

export function buildOpencodeConfig(input: OpencodeConfigInput): Record<string, unknown> {
  const interactive = input.interactive !== false;
  const config: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    snapshot: false,
    plugin: [],
    instructions: [input.instructionsPath],
    permission: {
      edit: 'allow',
      bash: 'allow',
      grep: 'allow',
      glob: 'allow',
      list: 'allow',
      read: 'allow',
      webfetch: 'deny',
      websearch: 'deny',
    },
  };
  if (!interactive) {
    config.lsp = false;
    config.formatter = false;
  }
  if (input.model) config.model = input.model;
  if (input.governed) {
    config.mcp = {
      bsh: {
        type: 'local',
        command: [process.execPath, input.mcpEntrypoint, input.repositorioOrigem, 'governed'],
        environment: { BSH_SESSION_DIR: input.sessaoDir },
        enabled: true,
        timeout: 60_000,
      },
    };
  }
  return config;
}

/** HOME privado com cópia de credenciais e configuração isolada do opencode. Nunca altera ~/.config nem ~/.local/share. */
export async function criarEstadoOpencode(
  repositorioOrigem: string,
  workspaceSessao: string,
  domains: string[] = [],
  model?: string,
  governed = true,
  interactive = true,
): Promise<EstadoOpencode> {
  const diretorio = await mkdtemp(join(homedir(), '.bsh-opencode-home-'));
  await chmod(diretorio, 0o700);
  const sessaoDir = join(diretorio, '.bsh-session');
  await mkdir(sessaoDir, { recursive: true, mode: 0o700 });

  const configDir = join(diretorio, '.config', 'opencode');
  const dataDir = join(diretorio, '.local', 'share', 'opencode');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  for (const filename of ['auth.json', 'mcp-auth.json']) {
    try {
      await copyFile(join(OPENCODE_DATA_DIRECTORY, filename), join(dataDir, filename));
      await chmod(join(dataDir, filename), 0o600);
    } catch {
      // arquivo opcional ou ausente
    }
  }

  const instructionsPath = join(diretorio, 'AGENTS.md');
  await writeFile(instructionsPath, buildGovernedOpencodeInstructions(domains), { mode: 0o600 });

  const mcpEntrypoint = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
  const config = buildOpencodeConfig({ mcpEntrypoint, repositorioOrigem, sessaoDir, instructionsPath, model, governed, interactive });
  await writeFile(join(configDir, 'opencode.json'), JSON.stringify(config, null, 2), { mode: 0o600 });

  return {
    diretorio,
    sessaoDir,
    async dispose() {
      await rm(diretorio, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Abre a TUI real do opencode na worktree (herda o terminal), como o BSH faz com Codex e Agy.
 * A TUI é o modo interativo principal: as aprovações nativas permanecem com o usuário. */
export function executarOpencodeTui(
  estado: EstadoOpencode,
  workspace: string,
  model?: string,
): Promise<number> {
  // Posicional: fixa o diretório do projeto na worktree isolada (impede o opencode de resolver para o origin).
  const args: string[] = [workspace];
  if (model) args.push('--model', model);
  const filho = spawn('opencode', args, {
    cwd: workspace,
    env: opencodeEnvironment(estado),
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    filho.once('error', reject);
    filho.once('exit', (codigo) => resolve(codigo ?? 0));
  });
}

export interface ResultadoOpencodeRun {
  codigo: number;
  saida: string;
}

/** Executa o opencode de forma não-interativa na worktree, com a mesma governança da TUI. */
export function executarOpencodePrompt(
  estado: EstadoOpencode,
  workspace: string,
  prompt: string,
  model?: string,
): Promise<ResultadoOpencodeRun> {
  const args = ['run', '--format', 'json', '--auto', '--dir', workspace];
  if (model) args.push('--model', model);
  args.push(prompt);
  return new Promise<ResultadoOpencodeRun>((resolve) => {
    const filho = spawn('opencode', args, {
      cwd: workspace,
      env: opencodeEnvironment(estado),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    let terminado = false;
    const finalizar = (codigo: number): void => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      resolve({ codigo, saida });
    };
    const timer = setTimeout(() => {
      filho.kill('SIGKILL');
      finalizar(124);
    }, 30 * 60_000);
    filho.stdout.on('data', (chunk: Buffer) => { saida += chunk.toString('utf8'); });
    filho.stderr.on('data', (chunk: Buffer) => { saida += chunk.toString('utf8'); });
    filho.once('error', (error: Error) => { saida += error.message; finalizar(1); });
    filho.once('exit', (codigo) => finalizar(codigo ?? 1));
  });
}

export async function lerAlertasOpencode(estado: EstadoOpencode): Promise<ConflictAlert[]> {
  return readConflictAlerts(join(estado.sessaoDir, 'alerts.jsonl'));
}

export async function contarConsultasOntologia(estado: EstadoOpencode): Promise<number> {
  return countLines(join(estado.sessaoDir, 'ontology-queries.jsonl'));
}

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

interface OpencodeUsageTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
  cache?: { read?: number; write?: number };
}

/** Varre objetos JSON de uma saída e devolve o último bloco de tokens observado (o mais cumulativo). */
export function extrairTokensDaSaida(saida: string): OpencodeTokens | undefined {
  let encontrado: OpencodeTokens | undefined;
  for (const linha of saida.split('\n')) {
    const texto = linha.trim();
    if (!texto.startsWith('{')) continue;
    let evento: unknown;
    try {
      evento = JSON.parse(texto);
    } catch {
      continue;
    }
    const tokens = buscarTokens(evento);
    if (tokens) encontrado = tokens;
  }
  return encontrado;
}

function buscarTokens(valor: unknown): OpencodeTokens | undefined {
  if (Array.isArray(valor)) {
    let encontrado: OpencodeTokens | undefined;
    for (const item of valor) {
      encontrado = buscarTokens(item) ?? encontrado;
    }
    return encontrado;
  }
  if (!valor || typeof valor !== 'object') return undefined;
  const registro = valor as Record<string, unknown>;
  const tokens = registro.tokens;
  if (tokens && typeof tokens === 'object') {
    const convertido = normalizarTokens(tokens as OpencodeUsageTokens);
    if (convertido) return convertido;
  }
  let encontrado: OpencodeTokens | undefined;
  for (const item of Object.values(registro)) {
    encontrado = buscarTokens(item) ?? encontrado;
  }
  return encontrado;
}

function normalizarTokens(tokens: OpencodeUsageTokens): OpencodeTokens | undefined {
  const entrada = numero(tokens.input);
  const saida = numero(tokens.output);
  if (entrada === 0 && saida === 0) return undefined;
  const raciocinio = numero(tokens.reasoning);
  const cache = numero(tokens.cache?.read);
  const total = numero(tokens.total) || entrada + saida + raciocinio + cache;
  return { entrada, saida, cache, raciocinio, totais: total };
}

/** Recupera a telemetria de tokens da sessão mais recente do opencode no HOME isolado. */
export async function extrairTokensDoEstadoOpencode(estado: EstadoOpencode): Promise<OpencodeTokens | undefined> {
  const env = opencodeEnvironment(estado);
  let identificador: string | undefined;
  try {
    const lista = await execFileAsync('opencode', ['session', 'list'], { env, timeout: 30_000 });
    const correspondencia = lista.stdout.match(/ses_[A-Za-z0-9]+/);
    identificador = correspondencia?.[0];
  } catch {
    return undefined;
  }
  if (!identificador) return undefined;
  try {
    const exportado = await execFileAsync('opencode', ['export', identificador], { env, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    const dados = JSON.parse(exportado.stdout) as { info?: { tokens?: OpencodeUsageTokens } };
    const tokens = dados.info?.tokens;
    return tokens ? normalizarTokens(tokens) : undefined;
  } catch {
    return undefined;
  }
}

/** Lê o modelo gravado na configuração isolada, para diagnóstico. */
export async function lerModeloConfigurado(estado: EstadoOpencode): Promise<string | undefined> {
  try {
    const conteudo = await readFile(join(estado.diretorio, '.config', 'opencode', 'opencode.json'), 'utf8');
    const config = JSON.parse(conteudo) as { model?: string };
    return config.model;
  } catch {
    return undefined;
  }
}
