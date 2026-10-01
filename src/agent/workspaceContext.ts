import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export interface WorkspaceSummary {
  projectName: string;
  projectDescription?: string;
  detectedTechnologies: string[];
  manifests: string[];
  scripts: Record<string, string>;
  topLevelEntries: string[];
  formattedContext: string;
}

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

export async function inspectWorkspace(workspaceRoot: string): Promise<WorkspaceSummary> {
  let projectName = basename(workspaceRoot);
  let projectDescription: string | undefined;
  const detectedTechnologies: string[] = [];
  const manifests: string[] = [];
  const scripts: Record<string, string> = {};
  const topLevelEntries: string[] = [];

  const rootEntries = await readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      // Sub-entries for depth 1
      const subEntries = await readdir(join(workspaceRoot, entry.name), { withFileTypes: true }).catch(() => []);
      const subNames = subEntries
        .filter((s) => !IGNORED_DIRS.has(s.name))
        .slice(0, 10)
        .map((s) => (s.isDirectory() ? `${s.name}/` : s.name));
      const suffix = subNames.length > 0 ? ` (${subNames.join(', ')})` : '';
      topLevelEntries.push(`${entry.name}/${suffix}`);
    } else {
      topLevelEntries.push(entry.name);
    }

    if (entry.name === 'package.json') {
      manifests.push('package.json');
      detectedTechnologies.push('Node.js / npm');
      try {
        const pkgRaw = await readFile(join(workspaceRoot, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgRaw);
        if (pkg.name) projectName = pkg.name;
        if (pkg.description) projectDescription = pkg.description;
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          for (const [k, v] of Object.entries(pkg.scripts)) {
            if (['test', 'build', 'quality', 'lint', 'start', 'dev'].some((prefix) => k.includes(prefix))) {
              scripts[k] = String(v);
            }
          }
        }
      } catch {
        // Ignore json parse error
      }
    } else if (entry.name === 'tsconfig.json') {
      manifests.push('tsconfig.json');
      detectedTechnologies.push('TypeScript');
    } else if (entry.name === 'pom.xml') {
      manifests.push('pom.xml');
      detectedTechnologies.push('Java / Maven');
    } else if (entry.name === 'requirements.txt' || entry.name === 'pyproject.toml') {
      manifests.push(entry.name);
      detectedTechnologies.push('Python');
    } else if (entry.name === 'Cargo.toml') {
      manifests.push('Cargo.toml');
      detectedTechnologies.push('Rust');
    } else if (entry.name === 'go.mod') {
      manifests.push('go.mod');
      detectedTechnologies.push('Go');
    }
  }

  // Deduplicate tech
  const uniqueTech = Array.from(new Set(detectedTechnologies));

  const lines: string[] = [
    `## Workspace Context (${projectName}):`,
    uniqueTech.length > 0 ? `- Technologies: ${uniqueTech.join(', ')}` : '',
    projectDescription ? `- Description: ${projectDescription}` : '',
    manifests.length > 0 ? `- Manifests: ${manifests.join(', ')}` : '',
    Object.keys(scripts).length > 0
      ? `- Key Scripts: ${Object.entries(scripts).map(([k, v]) => `npm run ${k} ("${v}")`).join(', ')}`
      : '',
    '- Top-Level Tree Structure:',
    ...topLevelEntries.slice(0, 20).map((e) => `  • ${e}`),
  ].filter(Boolean);

  return {
    projectName,
    projectDescription,
    detectedTechnologies: uniqueTech,
    manifests,
    scripts,
    topLevelEntries,
    formattedContext: lines.join('\n'),
  };
}
