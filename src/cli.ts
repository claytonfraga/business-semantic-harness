#!/usr/bin/env node

import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { addDomain, initProject } from './project/scaffold.js';
import { queryOntology } from './ontology/query.js';
import { validateProject } from './ontology/validate.js';
import { resolverRepositorio } from './git/worktree.js';
import { limparSessao, listarSessoesDoProjeto } from './git/sessions.js';

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.2.12-beta';
  } catch {
    return '0.2.12-beta';
  }
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    process.stdout.write(`${getVersion()}\n`);
    return 0;
  }
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('bsh: [tui] [--model <nome>] [--domain <nome>] [--api-key <key>] | init | domain add <nome> | ontology validate | ontology show <dominio> | sessions list|clean <id> | mcp [--governed] | auth [login|status|logout] | skill [list|show|add]\n');
    return 0;
  }

  const projectFlag = argv.indexOf('--project');
  if (projectFlag >= 0 && !argv[projectFlag + 1]) {
    process.stderr.write('Caminho ausente após --project.\n');
    return 2;
  }
  const projectRoot = resolve(projectFlag >= 0 ? argv[projectFlag + 1] : process.cwd());
  const argsWithoutProject = projectFlag >= 0 ? argv.filter((_, index) => index !== projectFlag && index !== projectFlag + 1) : argv;

  const apiKeyFlag = argsWithoutProject.indexOf('--api-key');
  if (apiKeyFlag >= 0 && !argsWithoutProject[apiKeyFlag + 1]) {
    process.stderr.write('Chave ausente após --api-key.\n');
    return 2;
  }
  if (apiKeyFlag >= 0) {
    process.env.OPENROUTER_API_KEY = argsWithoutProject[apiKeyFlag + 1];
  }

  const modelFlag = argsWithoutProject.findIndex((arg) => arg === '--model' || arg === '-m');
  let model: string | undefined;
  if (modelFlag >= 0 && !argsWithoutProject[modelFlag + 1]) {
    process.stderr.write('Modelo ausente após --model.\n');
    return 2;
  }
  if (modelFlag >= 0) {
    model = argsWithoutProject[modelFlag + 1];
  }

  const domainFlag = argsWithoutProject.findIndex((arg) => arg === '--domain' || arg === '-d');
  let domain: string | undefined;
  if (domainFlag >= 0 && !argsWithoutProject[domainFlag + 1]) {
    process.stderr.write('Domínio ausente após --domain.\n');
    return 2;
  }
  if (domainFlag >= 0) {
    domain = argsWithoutProject[domainFlag + 1];
  }

  const flagsToRemove = [
    apiKeyFlag >= 0 ? [apiKeyFlag, apiKeyFlag + 1] : [],
    modelFlag >= 0 ? [modelFlag, modelFlag + 1] : [],
    domainFlag >= 0 ? [domainFlag, domainFlag + 1] : [],
  ].flat();

  let command = flagsToRemove.length > 0
    ? argsWithoutProject.filter((_, index) => !flagsToRemove.includes(index))
    : argsWithoutProject;

  const promptFlag = command.indexOf('--prompt');
  const promptFileFlag = command.indexOf('--prompt-file');
  if (promptFlag >= 0 && !command[promptFlag + 1]) {
    process.stderr.write('Texto ausente após --prompt.\n');
    return 2;
  }
  if (promptFileFlag >= 0 && !command[promptFileFlag + 1]) {
    process.stderr.write('Caminho ausente após --prompt-file.\n');
    return 2;
  }

  let promptText: string | undefined;
  if (promptFlag >= 0) {
    promptText = command[promptFlag + 1];
  } else if (promptFileFlag >= 0) {
    const filePath = resolve(projectRoot, command[promptFileFlag + 1]);
    const { readFile } = await import('node:fs/promises');
    promptText = await readFile(filePath, 'utf8');
  }

  const promptIndexes = [promptFlag, promptFileFlag].filter((index) => index >= 0).flatMap((index) => [index, index + 1]);
  command = command.filter((_, index) => !promptIndexes.includes(index));

  try {
    if (promptText) {
      const { runHeadlessCodingSession } = await import('./agent/headless.js');
      return await runHeadlessCodingSession({
        projectRoot,
        prompt: promptText,
        model,
        domain,
      });
    }

    if (command.length === 0 || (command.length === 1 && command[0] === 'tui')) {
      const { launchTui } = await import('./tui/runtime.js');
      await launchTui({ projectRoot, model, domain });
      return Number(process.exitCode ?? 0);
    }
    if (command.length >= 1 && command[0] === 'mcp') {
      const governed = command.includes('--governed') || argsWithoutProject.includes('--governed');
      const { main: runMcpServer } = await import('./mcp/server.js');
      await runMcpServer(projectRoot, governed);
      return 0;
    }
    if (command.length >= 1 && command[0] === 'auth') {
      const { handleAuthCommand } = await import('./cli/authCommand.js');
      return await handleAuthCommand(command.slice(1), projectRoot);
    }
    if (command.length >= 1 && (command[0] === 'skill' || command[0] === 'skills')) {
      const { handleSkillCliCommand } = await import('./skills/cliCommand.js');
      return await handleSkillCliCommand(command.slice(1), projectRoot);
    }

    if (command.length === 1 && command[0] === 'init') {
      await initProject(projectRoot);
      process.stdout.write(`Projeto BSH criado em ${projectRoot}. Adicione ao menos um domínio.\n`);
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
    if (command.length === 2 && command[0] === 'sessions' && command[1] === 'list') {
      const repositorio = await resolverRepositorio(projectRoot);
      const sessoes = await listarSessoesDoProjeto(repositorio);
      if (sessoes.length === 0) {
        process.stdout.write('Nenhuma sessao registrada.\n');
        return 0;
      }
      for (const sessao of sessoes) {
        process.stdout.write(`${sessao.id}\testado=${sessao.estado}\tbranch=${sessao.branch}\tworktree=${sessao.worktree}${sessao.orfa ? '\t[ORFA]' : ''}\n`);
      }
      return 0;
    }
    if (command.length === 3 && command[0] === 'sessions' && command[1] === 'clean') {
      const repositorio = await resolverRepositorio(projectRoot);
      const resultado = await limparSessao(repositorio, command[2]);
      process.stdout.write(`${resultado.detalhes}\n`);
      return resultado.removida ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  process.stderr.write('Comando desconhecido. Use bsh --help.\n');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
