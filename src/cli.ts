#!/usr/bin/env node

import { addDomain, initProject } from './project/scaffold.js';

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('oracle: init | domain add | ontology validate | ontology show\n');
    return 0;
  }

  const projectFlag = argv.indexOf('--project');
  if (projectFlag >= 0 && !argv[projectFlag + 1]) {
    process.stderr.write('Caminho ausente após --project.\n');
    return 2;
  }
  const projectRoot = projectFlag >= 0 ? argv[projectFlag + 1] : process.cwd();
  const command = projectFlag >= 0 ? argv.filter((_, index) => index !== projectFlag && index !== projectFlag + 1) : argv;
  try {
    if (command.length === 1 && command[0] === 'init') {
      await initProject(projectRoot);
      process.stdout.write(`Projeto Oracle criado em ${projectRoot}. Adicione ao menos um domínio.\n`);
      return 0;
    }
    if (command.length === 3 && command[0] === 'domain' && command[1] === 'add') {
      await addDomain(projectRoot, command[2]);
      process.stdout.write(`Domínio ${command[2]} criado. Defina conceitos e regras antes de iniciar sessões.\n`);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  process.stderr.write('Comando desconhecido. Use oracle --help.\n');
  return 2;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2));
}
