import { readFile, writeFile, readdir } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../client/openrouter/types.js';

export const AGENT_TOOLS: ToolDefinition[] = [
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
      description: 'Execute a bash command (e.g. tests, lint, git status) inside the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command string to execute.' },
        },
        required: ['command'],
      },
    },
  },
];

export class WorkspaceToolExecutor {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
