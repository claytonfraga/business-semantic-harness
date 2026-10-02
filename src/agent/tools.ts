import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep, relative, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../client/openrouter/types.js';
import { SkillRegistry } from '../skills/registry.js';

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

export class WorkspaceToolExecutor {
  private workspaceRoot: string;
  private projectRoot: string;

  constructor(workspaceRoot: string, projectRoot?: string) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.projectRoot = resolve(projectRoot || workspaceRoot);
  }

  private resolveSafePath(relPath: string): string {
    const cleanRel = (relPath || '').trim();
    if (isAbsolute(cleanRel)) {
      throw new Error(`Absolute paths are not allowed: ${cleanRel}`);
    }
    const resolved = resolve(this.workspaceRoot, cleanRel);
    if (!resolved.startsWith(this.workspaceRoot + sep) && resolved !== this.workspaceRoot) {
      throw new Error(`Path escapes workspace: ${cleanRel}`);
    }
    return resolved;
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'search_code': {
        const query = String(args.query || '');
        if (!query.trim()) {
          throw new Error('Missing query parameter for search_code.');
        }
        const isRegex = Boolean(args.is_regex);
        const prefix = String(args.path_prefix || '');
        const targetDir = prefix ? this.resolveSafePath(prefix) : this.workspaceRoot;
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
        await searchCodeInDir(targetDir, this.workspaceRoot, regex, maxResults, results);
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
        await findFilesInDir(this.workspaceRoot, this.workspaceRoot, pattern, maxResults, results);
        if (results.length === 0) {
          return `No files found matching pattern: "${pattern}"`;
        }
        return `Found ${results.length} files:\n${results.join('\n')}`;
      }

      case 'read_file': {
        const filePath = this.resolveSafePath(String(args.path || ''));
        const content = await readFile(filePath, 'utf8');
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
        const filePath = this.resolveSafePath(String(args.path || ''));
        const content = String(args.content ?? '');
        await writeFile(filePath, content, 'utf8');
        return `Successfully wrote ${content.length} characters to ${String(args.path)}`;
      }

      case 'replace_file_content': {
        const filePath = this.resolveSafePath(String(args.path || ''));
        const target = String(args.target_content ?? '');
        const replacement = String(args.replacement_content ?? '');
        const current = await readFile(filePath, 'utf8');
        if (!current.includes(target)) {
          throw new Error(`Target content not found in file: ${String(args.path)}`);
        }
        const updated = current.replace(target, replacement);
        await writeFile(filePath, updated, 'utf8');
        return `Successfully replaced target content in ${String(args.path)}`;
      }

      case 'list_directory': {
        const dirPath = this.resolveSafePath(String(args.path || '.'));
        const entries = await readdir(dirPath, { withFileTypes: true });
        const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return list.join('\n');
      }

      case 'run_bash_command': {
        const cmd = String(args.command || '');
        return new Promise<string>((resolvePromise) => {
          const proc = spawn('bash', ['-c', cmd], {
            cwd: this.workspaceRoot,
            env: { ...process.env, PAGER: 'cat' },
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
