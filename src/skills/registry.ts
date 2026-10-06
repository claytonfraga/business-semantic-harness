import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Skill, SkillRegistryOptions, SkillScope } from './types.js';
import { parseSkillFrontmatter } from './frontmatter.js';

export class SkillRegistry {
  private cachedSkills: Skill[] | null = null;
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = resolve(projectRoot || process.cwd());
  }

  public clearCache(): void {
    this.cachedSkills = null;
  }

  public async discover(options?: SkillRegistryOptions): Promise<Skill[]> {
    if (this.cachedSkills && !options?.projectRoot && !options?.customRoots) {
      return this.cachedSkills;
    }

    const projectRoot = resolve(options?.projectRoot || this.projectRoot);
    const skillsMap = new Map<string, Skill>();

    // 1. Project Local Roots (Highest Precedence)
    const projectRoots = [
      join(projectRoot, '.bsh', 'skills'),
      join(projectRoot, '.agents', 'skills'),
      join(projectRoot, '.skills'),
    ];

    for (const root of projectRoots) {
      await this.scanDirectory(root, 'project', skillsMap);
    }

    // 2. Custom Roots (if provided)
    if (options?.customRoots) {
      for (const root of options.customRoots) {
        await this.scanDirectory(root, 'project', skillsMap);
      }
    }

    // 3. User Global Roots (Lowest Precedence, can be overridden by project)
    if (options?.enableGlobal !== false) {
      const globalRoots = [
        join(homedir(), '.config', 'bsh', 'skills'),
        join(homedir(), '.skills'),
        join(homedir(), '.agents', 'skills'),
        join(homedir(), '.claude', 'skills'),
        join(homedir(), '.gemini', 'config', 'plugins', 'agent-skills', 'skills'),
      ];

      for (const root of globalRoots) {
        await this.scanDirectory(root, 'global', skillsMap);
      }
    }

    const skills = Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    this.cachedSkills = skills;
    return skills;
  }

  public async get(name: string): Promise<Skill | undefined> {
    const skills = await this.discover();
    const normalized = name.trim().toLowerCase();
    return skills.find((s) => s.name.toLowerCase() === normalized);
  }

  private async scanDirectory(
    dirPath: string,
    scope: SkillScope,
    skillsMap: Map<string, Skill>
  ): Promise<void> {
    try {
      const dirStat = await stat(dirPath).catch(() => null);
      if (!dirStat?.isDirectory()) return;

      const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(dirPath, entry.name);
          const skillFile = join(skillDir, 'SKILL.md');

          const skillStat = await stat(skillFile).catch(() => null);
          if (skillStat?.isFile()) {
            await this.loadSkillFromFile(skillFile, skillDir, entry.name, scope, skillsMap);
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.skill.md')) {
          const skillFile = join(dirPath, entry.name);
          const fallbackName = entry.name.replace(/\.skill\.md$/i, '');
          await this.loadSkillFromFile(skillFile, dirPath, fallbackName, scope, skillsMap);
        }
      }
    } catch {
      // Ignore directory access errors gracefully
    }
  }

  private async loadSkillFromFile(
    filePath: string,
    directoryPath: string,
    fallbackName: string,
    scope: SkillScope,
    skillsMap: Map<string, Skill>
  ): Promise<void> {
    try {
      const raw = await readFile(filePath, 'utf8');
      const { metadata, body } = parseSkillFrontmatter(raw, fallbackName);
      const name = metadata.name || fallbackName;

      // Project scope takes precedence over global scope
      const existing = skillsMap.get(name);
      if (existing) {
        if (existing.scope === 'project' && scope === 'global') {
          return;
        }
      }

      // Collect associated files
      const dirEntries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
      const associatedFiles = dirEntries
        .filter((e) => e.isFile() && e.name !== 'SKILL.md')
        .map((e) => e.name);

      const skill: Skill = {
        name,
        description: metadata.description || 'No description provided.',
        scope,
        filePath,
        sourceHash: createHash('sha256').update(raw).digest('hex'),
        directoryPath,
        body,
        metadata,
        associatedFiles,
      };

      skillsMap.set(name, skill);
    } catch {
      // Resilient: skip corrupted skill files
    }
  }

  public formatSkillsSummary(skills: Skill[]): string {
    if (skills.length === 0) {
      return 'Nenhuma skill encontrada.';
    }

    const lines: string[] = ['SKILLS DISPONÍVEIS:'];
    for (const s of skills) {
      const scopeBadge = s.scope === 'project' ? '[project]' : '[global]';
      lines.push(`• ${s.name} ${scopeBadge} - ${s.description}`);
    }
    return lines.join('\n');
  }

  public formatSkillsForPrompt(skills: Skill[], activeSkillNames?: string[]): string {
    if (skills.length === 0) return '';

    const activeSet = new Set((activeSkillNames || []).map((n) => n.toLowerCase()));
    const activeSkills = skills.filter((s) => activeSet.has(s.name.toLowerCase()));

    const lines: string[] = ['## Available Agent Skills:'];
    for (const s of skills) {
      const isActive = activeSet.has(s.name.toLowerCase());
      lines.push(`- **${s.name}** (${s.scope}): ${s.description}${isActive ? ' [ACTIVE]' : ''}`);
    }

    if (activeSkills.length > 0) {
      lines.push('', '## Active Skill Instructions:');
      for (const active of activeSkills) {
        lines.push(`### Skill Directives: ${active.name}`);
        lines.push(active.body);
        if (active.associatedFiles.length > 0) {
          lines.push(`*Associated resources available in*: \`${active.directoryPath}\` (${active.associatedFiles.join(', ')})`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}
