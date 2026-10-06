import { readFile, readdir, stat, lstat, realpath, open, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, sep, relative, join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { ToolDefinition } from '../client/openrouter/types.js';
import { SkillRegistry } from '../skills/registry.js';
import type { ApprovalBroker } from '../decision/broker.js';
import { BrokerAuthorizationError } from '../decision/broker.js';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search for text or regular expression inside source files in the project workspace, ignoring build/cache directories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'String or regex pattern to search for.' },
          is_regex: { type: 'boolean', description: 'Whether the query is a regular expression (default: false).' },
          path_prefix: { type: 'string', description: 'Optional subfolder to restrict search to (e.g. "src" or "test").' },
          max_results: { type: 'number', description: 'Maximum number of matching lines to return (default: 30).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files matching a substring or pattern across the workspace, ignoring artifact directories.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Substring or file extension to match (e.g. "session", ".ts", "domain").' },
          max_results: { type: 'number', description: 'Maximum number of paths to return (default: 50).' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file within the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file from workspace root.' },
          start_line: { type: 'number', description: 'Optional 1-based start line number.' },
          end_line: { type: 'number', description: 'Optional 1-based end line number.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file with the provided content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file from workspace root.' },
          content: { type: 'string', description: 'Full text content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_file_content',
      description: 'Perform a surgical find-and-replace edit on an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file.' },
          target_content: { type: 'string', description: 'Exact string to be replaced.' },
          replacement_content: { type: 'string', description: 'Replacement string.' },
        },
        required: ['path', 'target_content', 'replacement_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and subdirectories at a given relative path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path. Defaults to root ("").' },
          recursive: { type: 'boolean', description: 'Whether to list recursively (limited depth).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_bash_command',
      description: 'Execute a bash command (e.g. tests, lint, git status, /usr/bin/rtk) inside the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command string to execute.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_skill',
      description: 'Inspect full instructions, documentation, and guidelines for an available agent skill (e.g. "prototype", "code-review").',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the skill to inspect.' },
        },
        required: ['name'],
      },
    },
  },
];

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.bsh',
  'dist',
  'build',
  '.superpowers',
  '.worktrees',
  '.bin',
  '__pycache__',
]);

async function searchCodeInDir(
  dir: string,
  baseDir: string,
  regex: RegExp,
  maxResults: number,
  results: string[],
  currentDepth = 0
): Promise<void> {
  if (currentDepth > 10 || results.length >= maxResults) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await searchCodeInDir(join(dir, entry.name), baseDir, regex, maxResults, results, currentDepth + 1);
      }
    } else if (entry.isFile()) {
      const fullPath = join(dir, entry.name);
      try {
        const s = await stat(fullPath);
        if (s.size > 500 * 1024) continue;
        const content = await readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        const relPath = relative(baseDir, fullPath);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i].trimEnd()}`);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

async function findFilesInDir(
  dir: string,
  baseDir: string,
  pattern: string,
  maxResults: number,
  results: string[],
  currentDepth = 0
): Promise<void> {
  if (currentDepth > 10 || results.length >= maxResults) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const lowerPattern = pattern.toLowerCase();
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await findFilesInDir(join(dir, entry.name), baseDir, pattern, maxResults, results, currentDepth + 1);
      }
    } else if (entry.isFile()) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(baseDir, fullPath);
      if (relPath.toLowerCase().includes(lowerPattern) || entry.name.toLowerCase().includes(lowerPattern)) {
        results.push(relPath);
      }
    }
  }
}

export const SAFE_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'PAGER',
  'TMPDIR',
  'NODE_PATH',
];

export function buildSafeEnv(
  extraEnv?: Record<string, string>,
  allowedKeys: readonly string[] = SAFE_ENV_ALLOWLIST
): Record<string, string> {
  const env: Record<string, string> = {};
  const allowedSet = new Set(allowedKeys);
  for (const key of allowedSet) {
    const val = process.env[key];
    if (typeof val === 'string') {
      env[key] = val;
    }
  }
  // Tool processes must not wait for a host's interactive pager.
  env.PAGER = 'cat';
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === 'string') {
        env[k] = v;
      }
    }
  }
  return env;
}

let _bwrapAvailable: boolean | null = null;

export function isBwrapAvailable(): boolean {
  if (_bwrapAvailable !== null) return _bwrapAvailable;
  try {
    const res = spawnSync('bwrap', ['--version'], { stdio: 'ignore' });
    _bwrapAvailable = res.status === 0;
  } catch {
    _bwrapAvailable = false;
  }
  return _bwrapAvailable;
}

export function setBwrapAvailableForTesting(val: boolean | null): void {
  _bwrapAvailable = val;
}

export interface ResolveSafePathOptions {
  forWriting?: boolean;
  allowRoot?: boolean;
}

export interface WorkspaceToolExecutorOptions {
  allowNetwork?: boolean;
  confinement?: boolean;
  allowedEnvVars?: readonly string[];
  extraEnv?: Record<string, string>;
  broker?: ApprovalBroker;
}

export class WorkspaceToolExecutor {
  private workspaceRoot: string;
  private projectRoot: string;
  private allowNetwork: boolean;
  private confinement: boolean;
  private allowedEnvVars: readonly string[];
  private extraEnv: Record<string, string>;
  private broker?: ApprovalBroker;

  constructor(
    workspaceRoot: string,
    projectRootOrOptions?: string | WorkspaceToolExecutorOptions,
    maybeOptions?: WorkspaceToolExecutorOptions
  ) {
    this.workspaceRoot = resolve(workspaceRoot);
    if (typeof projectRootOrOptions === 'string') {
      this.projectRoot = resolve(projectRootOrOptions);
      this.allowNetwork = maybeOptions?.allowNetwork ?? false;
      this.confinement = maybeOptions?.confinement ?? true;
      this.allowedEnvVars = maybeOptions?.allowedEnvVars ?? SAFE_ENV_ALLOWLIST;
      this.extraEnv = maybeOptions?.extraEnv ?? {};
      this.broker = maybeOptions?.broker;
    } else {
      this.projectRoot = resolve(workspaceRoot);
      const opts = projectRootOrOptions ?? {};
      this.allowNetwork = opts.allowNetwork ?? false;
      this.confinement = opts.confinement ?? true;
      this.allowedEnvVars = opts.allowedEnvVars ?? SAFE_ENV_ALLOWLIST;
      this.extraEnv = opts.extraEnv ?? {};
      this.broker = opts.broker;
    }
  }

  setBroker(broker: ApprovalBroker): void {
    this.broker = broker;
  }

  async getCanonicalWorkspaceRoot(): Promise<string> {
    return await realpath(this.workspaceRoot);
  }

  private isInsideCanonicalRoot(canonicalRoot: string, targetPath: string): boolean {
    const fromRoot = relative(canonicalRoot, targetPath);
    return Boolean(
      fromRoot &&
      fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot)
    );
  }

  async resolveSafePath(
    relPath: string,
    options: ResolveSafePathOptions = {}
  ): Promise<string> {
    const cleanRel = (relPath || '').trim();
    if (!cleanRel) {
      if (options.allowRoot) {
        return await this.getCanonicalWorkspaceRoot();
      }
      throw new Error('Path escapes workspace: empty path');
    }

    if (isAbsolute(cleanRel)) {
      throw new Error(`Path escapes workspace: absolute paths are not allowed: ${cleanRel}`);
    }

    const canonicalRoot = await this.getCanonicalWorkspaceRoot();
    const lexicalTarget = resolve(canonicalRoot, cleanRel);

    if (lexicalTarget === canonicalRoot) {
      if (options.allowRoot) {
        return canonicalRoot;
      }
      throw new Error(`Path escapes workspace: ${cleanRel}`);
    }

    if (!lexicalTarget.startsWith(canonicalRoot + sep)) {
      throw new Error(`Path escapes workspace: ${cleanRel}`);
    }

    if (options.forWriting) {
      const fromRootLexical = relative(canonicalRoot, lexicalTarget);
      const firstSegmentLexical = fromRootLexical.split(sep)[0];
      if (firstSegmentLexical === '.git' || firstSegmentLexical === '.bsh') {
        throw new Error(`Write access denied: protected path ${cleanRel}`);
      }
    }

    // Check if lexicalTarget exists
    let targetExists = false;
    let isSymlink = false;
    try {
      const st = await lstat(lexicalTarget);
      targetExists = true;
      isSymlink = st.isSymbolicLink();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    if (targetExists) {
      let canonicalTarget: string;
      try {
        canonicalTarget = await realpath(lexicalTarget);
      } catch (err: unknown) {
        if (isSymlink) {
          throw new Error(`Path escapes workspace via symlink: ${cleanRel}`);
        }
        throw err;
      }

      const isValid = options.allowRoot
        ? canonicalTarget === canonicalRoot || this.isInsideCanonicalRoot(canonicalRoot, canonicalTarget)
        : this.isInsideCanonicalRoot(canonicalRoot, canonicalTarget);

      if (!isValid) {
        throw new Error(`Path escapes workspace: ${cleanRel}`);
      }

      if (options.forWriting) {
        const fromRootTarget = relative(canonicalRoot, canonicalTarget);
        const firstSegmentTarget = fromRootTarget.split(sep)[0];
        if (firstSegmentTarget === '.git' || firstSegmentTarget === '.bsh') {
          throw new Error(`Write access denied: protected path ${cleanRel}`);
        }
      }

      return canonicalTarget;
    }

    // Target does not exist yet (e.g. for write_file creating a new file).
    // Inspect ancestor directories up to canonicalRoot to ensure no ancestor escapes workspace via symlink.
    let currentDir = dirname(lexicalTarget);
    let checkedAncestor = false;

    while (currentDir.length >= canonicalRoot.length) {
      try {
        await lstat(currentDir);
        const canonicalAncestor = await realpath(currentDir);
        const ancestorValid =
          canonicalAncestor === canonicalRoot || this.isInsideCanonicalRoot(canonicalRoot, canonicalAncestor);
        if (!ancestorValid) {
          throw new Error(`Path escapes workspace: ${cleanRel}`);
        }
        checkedAncestor = true;
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          const parent = dirname(currentDir);
          if (parent === currentDir) break;
          currentDir = parent;
        } else {
          throw err;
        }
      }
    }

    if (!checkedAncestor) {
      throw new Error(`Path escapes workspace: ${cleanRel}`);
    }

    return lexicalTarget;
  }

  private async assertFileDescriptorInsideRoot(fd: number, canonicalRoot: string, fallbackPath: string): Promise<void> {
    let canonicalFd: string | null = null;
    const fdProcPath = `/proc/self/fd/${fd}`;
    try {
      canonicalFd = await realpath(fdProcPath);
    } catch {
      try {
        canonicalFd = await realpath(fallbackPath);
      } catch {
        canonicalFd = null;
      }
    }

    if (canonicalFd) {
      if (canonicalFd === canonicalRoot || !this.isInsideCanonicalRoot(canonicalRoot, canonicalFd)) {
        throw new Error(`Path escapes workspace: ${fallbackPath}`);
      }
    }
  }

  private async safeReadFile(filePath: string): Promise<string> {
    const canonicalRoot = await this.getCanonicalWorkspaceRoot();
    const handle = await open(filePath, 'r');
    try {
      await this.assertFileDescriptorInsideRoot(handle.fd, canonicalRoot, filePath);
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  }

  private async safeWriteFile(filePath: string, content: string): Promise<void> {
    const canonicalRoot = await this.getCanonicalWorkspaceRoot();
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Open file handle with O_CREAT | O_RDWR (without O_TRUNC to prevent premature truncation before verification)
    const handle = await open(filePath, constants.O_CREAT | constants.O_RDWR);
    try {
      await this.assertFileDescriptorInsideRoot(handle.fd, canonicalRoot, filePath);
      await handle.truncate(0);
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  }

  async executeTool(name: string, args: Record<string, unknown>, actionId?: string, domain?: string): Promise<string> {
    if (this.broker) {
      const auth = await this.broker.authorizeToolCall({
        actionId,
        domain,
        tool: name,
        args,
      });
      if (!auth.allowed) {
        throw new BrokerAuthorizationError(name, auth.reason);
      }
    }

    switch (name) {
      case 'search_code': {
        const query = String(args.query || '');
        if (!query.trim()) {
          throw new Error('Missing query parameter for search_code.');
        }
        const isRegex = Boolean(args.is_regex);
        const prefix = String(args.path_prefix || '');
        const targetDir = prefix ? await this.resolveSafePath(prefix, { allowRoot: true }) : await this.getCanonicalWorkspaceRoot();
        const maxResults = typeof args.max_results === 'number' ? Math.min(100, Math.max(1, args.max_results)) : 30;

        let regex: RegExp;
        try {
          if (isRegex || (args.is_regex === undefined && query.includes('|'))) {
            regex = new RegExp(query, 'i');
          } else {
            regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          }
        } catch {
          regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const results: string[] = [];
        await searchCodeInDir(targetDir, await this.getCanonicalWorkspaceRoot(), regex, maxResults, results);
        if (results.length === 0) {
          return `No matches found for query: "${query}"`;
        }
        return `Found ${results.length} matches:\n${results.join('\n')}`;
      }

      case 'find_files': {
        const pattern = String(args.pattern || '');
        if (!pattern.trim()) {
          throw new Error('Missing pattern parameter for find_files.');
        }
        const maxResults = typeof args.max_results === 'number' ? Math.min(200, Math.max(1, args.max_results)) : 50;
        const results: string[] = [];
        const canonicalRoot = await this.getCanonicalWorkspaceRoot();
        await findFilesInDir(canonicalRoot, canonicalRoot, pattern, maxResults, results);
        if (results.length === 0) {
          return `No files found matching pattern: "${pattern}"`;
        }
        return `Found ${results.length} files:\n${results.join('\n')}`;
      }

      case 'read_file': {
        const filePath = await this.resolveSafePath(String(args.path || ''));
        const content = await this.safeReadFile(filePath);
        const startLine = typeof args.start_line === 'number' ? args.start_line : 1;
        const endLine = typeof args.end_line === 'number' ? args.end_line : undefined;

        if (startLine > 1 || endLine !== undefined) {
          const lines = content.split('\n');
          const slice = lines.slice(Math.max(0, startLine - 1), endLine ? Math.min(lines.length, endLine) : undefined);
          return slice.join('\n');
        }
        return content;
      }

      case 'write_file': {
        const filePath = await this.resolveSafePath(String(args.path || ''), { forWriting: true });
        const content = String(args.content ?? '');
        await this.safeWriteFile(filePath, content);
        return `Successfully wrote ${content.length} characters to ${String(args.path)}`;
      }

      case 'replace_file_content': {
        const filePath = await this.resolveSafePath(String(args.path || ''), { forWriting: true });
        const target = String(args.target_content ?? '');
        const replacement = String(args.replacement_content ?? '');
        const current = await this.safeReadFile(filePath);
        if (!current.includes(target)) {
          throw new Error(`Target content not found in file: ${String(args.path)}`);
        }
        const updated = current.replace(target, replacement);
        await this.safeWriteFile(filePath, updated);
        return `Successfully replaced target content in ${String(args.path)}`;
      }

      case 'list_directory': {
        const dirPath = await this.resolveSafePath(String(args.path || '.'), { allowRoot: true });
        const entries = await readdir(dirPath, { withFileTypes: true });
        const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return list.join('\n');
      }

      case 'run_bash_command': {
        const cmd = String(args.command || '');
        const safeEnv = buildSafeEnv(this.extraEnv, this.allowedEnvVars);
        const canonicalWorkspace = await this.getCanonicalWorkspaceRoot();

        let commandBinary = 'bash';
        let commandArgs = ['-c', cmd];

        if (this.confinement && isBwrapAvailable()) {
          commandBinary = 'bwrap';
          const bwrapArgs: string[] = [
            '--ro-bind', '/', '/',
            '--dev', '/dev',
            '--proc', '/proc',
            '--tmpfs', '/tmp',
            '--bind', canonicalWorkspace, canonicalWorkspace,
          ];

          const gitPath = join(canonicalWorkspace, '.git');
          try {
            await lstat(gitPath);
            bwrapArgs.push('--ro-bind', gitPath, gitPath);
          } catch {
            // .git not present
          }

          const bshPath = join(canonicalWorkspace, '.bsh');
          try {
            await lstat(bshPath);
            bwrapArgs.push('--ro-bind', bshPath, bshPath);
          } catch {
            // .bsh not present
          }

          if (!this.allowNetwork) {
            bwrapArgs.push('--unshare-net');
          }

          bwrapArgs.push('bash', '-c', cmd);
          commandArgs = bwrapArgs;
        }

        return new Promise<string>((resolvePromise) => {
          const proc = spawn(commandBinary, commandArgs, {
            cwd: this.workspaceRoot,
            env: safeEnv,
          });

          let stdout = '';
          let stderr = '';
          const maxLen = 30000;

          proc.stdout?.on('data', (d) => {
            if (stdout.length < maxLen) stdout += d.toString('utf8');
          });
          proc.stderr?.on('data', (d) => {
            if (stderr.length < maxLen) stderr += d.toString('utf8');
          });

          const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            resolvePromise(`Command timed out after 30 seconds.\nStdout: ${stdout}\nStderr: ${stderr}`);
          }, 30000);

          proc.on('close', (code) => {
            clearTimeout(timer);
            let out = stdout;
            if (stderr) {
              out += (out ? '\n--- STDERR ---\n' : '') + stderr;
            }
            resolvePromise(`Exit code: ${code}\n${out.trim()}`);
          });

          proc.on('error', (err) => {
            clearTimeout(timer);
            resolvePromise(`Process error: ${err.message}`);
          });
        });
      }

      case 'inspect_skill': {
        const skillName = String(args.name || '').trim();
        if (!skillName) {
          throw new Error('Missing "name" parameter for inspect_skill.');
        }
        const registry = new SkillRegistry(this.projectRoot);
        const skill = await registry.get(skillName);
        if (!skill) {
          return `Skill "${skillName}" was not found. Available skills can be checked via system instructions or bsh skill list.`;
        }
        const filesInfo = skill.associatedFiles.length > 0 ? `\nAssociated Files: ${skill.associatedFiles.join(', ')}` : '';
        return `Skill: ${skill.name} (${skill.scope})\nDescription: ${skill.description}\nFile: ${skill.filePath}${filesInfo}\n\n--- Skill Guidelines ---\n${skill.body}`;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
