import { SkillRegistry } from './registry.js';
import { installSkillPackage } from './installer.js';

export async function handleSkillCliCommand(
  args: string[],
  projectRoot: string
): Promise<number> {
  const subCommand = args[0] || 'list';
  const registry = new SkillRegistry(projectRoot);

  if (subCommand === 'list' || subCommand === 'ls') {
    const skills = await registry.discover();
    if (skills.length === 0) {
      process.stdout.write('Nenhuma skill encontrada no projeto ou no escopo global.\n');
      return 0;
    }

    process.stdout.write(`\nSkills disponíveis (${skills.length}):\n`);
    for (const skill of skills) {
      const scopeBadge = skill.scope === 'project' ? '[project]' : '[global]';
      process.stdout.write(`  • ${skill.name} ${scopeBadge}\n    ${skill.description}\n`);
    }
    process.stdout.write('\n');
    return 0;
  }

  if (subCommand === 'show' || subCommand === 'info') {
    const skillName = args[1];
    if (!skillName) {
      process.stderr.write('Nome da skill ausente. Uso: bsh skill show <nome>\n');
      return 2;
    }

    const skill = await registry.get(skillName);
    if (!skill) {
      process.stderr.write(`Skill '${skillName}' não encontrada.\n`);
      return 1;
    }

    process.stdout.write(`\nSkill: ${skill.name} (${skill.scope})\n`);
    process.stdout.write(`Arquivo: ${skill.filePath}\n`);
    process.stdout.write(`Descrição: ${skill.description}\n`);
    if (skill.associatedFiles.length > 0) {
      process.stdout.write(`Arquivos associados: ${skill.associatedFiles.join(', ')}\n`);
    }
    process.stdout.write('\n--- Instruções da Skill ---\n\n');
    process.stdout.write(skill.body);
    process.stdout.write('\n\n');
    return 0;
  }

  if (subCommand === 'add' || subCommand === 'install') {
    const source = args[1];
    if (!source) {
      process.stderr.write('Fonte da skill ausente. Uso: bsh skill add <pacote> [--skill=<nome>] [--global]\n');
      return 2;
    }

    let specificSkill: string | undefined;
    let isGlobal = false;

    for (const arg of args.slice(2)) {
      if (arg.startsWith('--skill=')) {
        specificSkill = arg.replace('--skill=', '');
      } else if (arg === '--skill' && args[args.indexOf(arg) + 1]) {
        specificSkill = args[args.indexOf(arg) + 1];
      } else if (arg === '--global' || arg === '-g') {
        isGlobal = true;
      }
    }

    process.stdout.write(`Instalando skill '${source}'${specificSkill ? ` (skill: ${specificSkill})` : ''}...\n`);
    const result = await installSkillPackage(source, {
      skill: specificSkill,
      global: isGlobal,
      projectRoot,
    });

    if (result.success) {
      process.stdout.write(`✔ Skill instalada com sucesso!\n`);
      registry.clearCache();
      return 0;
    } else {
      process.stderr.write(`Erro ao instalar skill:\n${result.error || result.output}\n`);
      return 1;
    }
  }

  process.stderr.write('Subcomando inválido. Uso: bsh skill [list | show <nome> | add <pacote>]\n');
  return 2;
}
