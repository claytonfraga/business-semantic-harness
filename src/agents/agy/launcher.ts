import { execFile, spawn } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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

  // Pré-confiança da worktree isolada e repositório de origem para a TUI do agy não pedir confirmação
  const trustedFolders: Record<string, string> = {
    [workspaceSessao]: 'TRUST_FOLDER',
    [repositorioOrigem]: 'TRUST_FOLDER',
  };
  try {
    const realWork = await realpath(workspaceSessao);
    trustedFolders[realWork] = 'TRUST_FOLDER';
  } catch {
    // caminho já léxico
  }
  try {
    const realOrigem = await realpath(repositorioOrigem);
    trustedFolders[realOrigem] = 'TRUST_FOLDER';
  } catch {
    // caminho já léxico
  }
  await writeFile(join(geminiDir, 'trustedFolders.json'), JSON.stringify(trustedFolders, null, 2), { mode: 0o600 });

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(join(realAgy, 'settings.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    // usa padrão vazio
  }
  const confiaveis = Array.isArray(settings.trustedWorkspaces) ? (settings.trustedWorkspaces as string[]) : [];
  for (const pasta of Object.keys(trustedFolders)) {
    if (!confiaveis.includes(pasta)) confiaveis.push(pasta);
  }
  settings.trustedWorkspaces = confiaveis;
  const permissions = (settings.permissions && typeof settings.permissions === 'object'
    ? settings.permissions
    : { allow: [] }) as { allow?: string[] };
  const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
  if (!allow.includes('*')) allow.push('*');
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

function parseVarint(buf: Buffer, offset: number): [number, number] {
  let res = 0;
  let shift = 0;
  let curr = offset;
  while (curr < buf.length) {
    const b = buf[curr++];
    res |= (b & 0x7F) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [res, curr];
}

/** Extrai tokens do banco de dados SQLite da sessão do Agy (.gemini/antigravity-cli/conversations/*.db). */
export async function extrairTokensDoEstadoAgy(estado: EstadoAgy): Promise<ResultadoAgy['tokens'] | undefined> {
  const convDir = join(estado.diretorio, '.gemini', 'antigravity-cli', 'conversations');
  let dbFiles: string[] = [];
  try {
    const entries = await readdir(convDir);
    dbFiles = entries.filter((f) => f.endsWith('.db')).map((f) => join(convDir, f));
  } catch {
    return undefined;
  }

  if (dbFiles.length === 0) return undefined;

  interface SqliteDatabase {
    prepare(sql: string): { all(): unknown[] };
    close(): void;
  }
  type SqliteDatabaseConstructor = new (path: string, options?: { open?: boolean; readOnly?: boolean }) => SqliteDatabase;

  let DatabaseSyncClass: SqliteDatabaseConstructor | undefined;
  try {
    const sqliteMod = (await import('node:sqlite')) as unknown as { DatabaseSync?: SqliteDatabaseConstructor };
    DatabaseSyncClass = sqliteMod.DatabaseSync;
  } catch {
    DatabaseSyncClass = undefined;
  }

  if (!DatabaseSyncClass) return undefined;

  let totalIn = 0;
  let totalOut = 0;
  let totalCache = 0;
  let totalReasoning = 0;
  let found = false;

  for (const dbPath of dbFiles) {
    try {
      const db = new DatabaseSyncClass(dbPath, { open: true, readOnly: true });
      try {
        const rows = db.prepare('SELECT idx, metadata FROM steps ORDER BY idx').all() as Array<{ idx: number; metadata: unknown }>;
        let lastInTurn: number | null = null;
        let sumOut = 0;
        let sumReasoning = 0;
        let lastCacheTurn = 0;

        for (const row of rows) {
          const meta = row.metadata ? Buffer.from(row.metadata as Uint8Array) : null;
          if (!meta) continue;

          let i = 0;
          while (i < meta.length) {
            const tagByte = meta[i++];
            const tag = tagByte >> 3;
            const wire = tagByte & 7;

            if (wire === 0) {
              const [, next] = parseVarint(meta, i);
              i = next;
            } else if (wire === 2) {
              const [len, next] = parseVarint(meta, i);
              i = next;
              const subEnd = i + len;
              if (subEnd > meta.length) break;

              if (tag === 9) {
                let sj = i;
                let inp: number | null = null;
                let out: number | null = null;
                let cache = 0;
                let reasoning = 0;
                while (sj < subEnd) {
                  const stByte = meta[sj++];
                  const stag = stByte >> 3;
                  const swire = stByte & 7;
                  if (swire === 0) {
                    const [val, nextS] = parseVarint(meta, sj);
                    sj = nextS;
                    if (stag === 2) inp = val;
                    else if (stag === 3) out = val;
                    else if (stag === 5) cache = val;
                    else if (stag === 6) reasoning = val;
                  } else if (swire === 2) {
                    const [slen, nextS] = parseVarint(meta, sj);
                    sj = nextS + slen;
                  } else {
                    break;
                  }
                }
                if (inp !== null && out !== null) {
                  lastInTurn = inp;
                  sumOut += out;
                  sumReasoning += reasoning;
                  lastCacheTurn = cache;
                }
              }
              i = subEnd;
            } else if (wire === 1) {
              i += 8;
            } else if (wire === 5) {
              i += 4;
            } else {
              break;
            }
          }
        }

        if (lastInTurn !== null) {
          totalIn += lastInTurn;
          totalOut += sumOut;
          totalCache += lastCacheTurn;
          totalReasoning += sumReasoning;
          found = true;
        }
      } finally {
        db.close();
      }
    } catch {
      // Ignora erro em arquivo corrompido ou temporário
    }
  }

  if (found && (totalIn > 0 || totalOut > 0)) {
    return {
      entrada: totalIn,
      saida: totalOut,
      cache: totalCache,
      raciocinio: totalReasoning,
      totais: totalIn + totalOut,
    };
  }

  return undefined;
}

