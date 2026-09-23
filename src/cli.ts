#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDomain, initProject } from './project/scaffold.js';
import { queryOntology } from './ontology/query.js';
import { validateProject } from './ontology/validate.js';
import { diagnoseCodex } from './agents/codex/doctor.js';

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('oracle: init | domain add | ontology validate | ontology show | doctor | code base | agy\n');
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
    if (command.length === 2 && command[0] === 'ontology' && command[1] === 'validate') {
      const report = await validateProject(projectRoot);
      if (report.issues.length === 0) {
        process.stdout.write('Ontologia válida e pronta.\n');
        return 0;
      }
      for (const issue of report.issues) {
        process.stderr.write(`${issue.severity} ${issue.domain} ${issue.file} ${issue.rule}: ${issue.message}\n`);
      }
      return 1;
    }
    if ((command.length === 3 || command.length === 4) && command[0] === 'ontology' && command[1] === 'show') {
      const result = await queryOntology(projectRoot, command[2], command[3]);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (command.length === 1 && command[0] === 'doctor') {
      const report = await diagnoseCodex(projectRoot);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ready ? 0 : 1;
    }
    if ((command.length === 1 && command[0] === 'codex') || (command.length === 2 && command[0] === 'code' && command[1] === 'base')) {
      const report = await diagnoseCodex(projectRoot);
      process.stderr.write(`Sessão governada indisponível: ${report.reasons.join('; ')}\n`);
      return 1;
    }
    if (command.length === 1 && command[0] === 'agy') {
      process.stderr.write('Adaptador Agy ainda não disponível: mediação de ações do Google Antigravity CLI não verificada.\n');
      return 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  process.stderr.write('Comando desconhecido. Use oracle --help.\n');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
