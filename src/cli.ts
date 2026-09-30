#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { addDomain, initProject } from './project/scaffold.js';
import { queryOntology } from './ontology/query.js';
import { validateProject } from './ontology/validate.js';
import { diagnoseCodex, diagnoseCodexRuntime } from './agents/codex/doctor.js';
import { diagnoseAgy, diagnoseAgyRuntime } from './agents/agy/launcher.js';
import { diagnoseOpencode, diagnoseOpencodeRuntime } from './agents/opencode/launcher.js';
import { runCodexSession } from './agents/codex/session.js';
import { runAgySession } from './agents/agy/session.js';
import { runOpencodeSession } from './agents/opencode/session.js';
import { resolverRepositorio } from './agents/codex/worktree.js';
import { limparSessao, listarSessoesDoProjeto } from './agents/codex/sessions.js';
import { startTuiSession } from './tui/session.js';

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('bsh: init | domain add | ontology validate | ontology show | doctor [agy|opencode] | code base | codex [--consultative] | agy [--model <nome>] | opencode [--model <nome>] [--consultative] [--prompt <texto>|--prompt-file <arquivo>] | sessions list|clean | benchmark <run|validate|smoke|analyze|report>\n');
    return 0;
  }

  const projectFlag = argv.indexOf('--project');
  if (projectFlag >= 0 && !argv[projectFlag + 1]) {
    process.stderr.write('Caminho ausente após --project.\n');
    return 2;
  }
  const projectRoot = resolve(projectFlag >= 0 ? argv[projectFlag + 1] : process.cwd());
  const argsWithoutProject = projectFlag >= 0 ? argv.filter((_, index) => index !== projectFlag && index !== projectFlag + 1) : argv;

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
    modelFlag >= 0 ? [modelFlag, modelFlag + 1] : [],
    domainFlag >= 0 ? [domainFlag, domainFlag + 1] : [],
  ].flat();

  let command = flagsToRemove.length > 0
    ? argsWithoutProject.filter((_, index) => !flagsToRemove.includes(index))
    : argsWithoutProject;

  const promptFlag = command.findIndex((arg) => arg === '--prompt');
  const promptFileFlag = command.findIndex((arg) => arg === '--prompt-file');
  if (promptFlag >= 0 && !command[promptFlag + 1]) {
    process.stderr.write('Texto ausente após --prompt.\n');
    return 2;
  }
  if (promptFileFlag >= 0 && !command[promptFileFlag + 1]) {
    process.stderr.write('Caminho ausente após --prompt-file.\n');
    return 2;
  }
  const promptValue = promptFlag >= 0 ? command[promptFlag + 1] : undefined;
  const promptFileValue = promptFileFlag >= 0 ? command[promptFileFlag + 1] : undefined;
  const promptIndexes = [promptFlag, promptFileFlag].filter((index) => index >= 0).flatMap((index) => [index, index + 1]);
  command = command.filter((_, index) => !promptIndexes.includes(index));

  try {
    let prompt = promptValue;
    if (promptFileValue) prompt = (await readFile(resolve(promptFileValue), 'utf8')).trim();

    if (command.length === 0 || (command.length === 1 && command[0] === 'tui')) {
      await startTuiSession({ projectRoot, model, domain });
      return 0;
    }
    if (command.length === 1 && command[0] === 'init') {      await initProject(projectRoot);
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
    if (command.length === 1 && command[0] === 'doctor') {
      const report = await diagnoseCodex(projectRoot);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ready ? 0 : 1;
    }
    if (command.length === 2 && command[0] === 'doctor' && command[1] === 'agy') {
      const report = await diagnoseAgy(projectRoot);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ready ? 0 : 1;
    }
    if (command.length === 2 && command[0] === 'doctor' && command[1] === 'opencode') {
      const report = await diagnoseOpencode(projectRoot);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.ready ? 0 : 1;
    }
    if ((command.length === 1 && command[0] === 'codex') ||
        (command.length === 2 && command[0] === 'codex' && command[1] === '--consultative') ||
        (command.length === 2 && command[0] === 'code' && command[1] === 'base')) {
      const report = await diagnoseCodexRuntime(projectRoot);
      if (!report.ready) {
        process.stderr.write(`Sessão governada indisponível: ${report.reasons.join('; ')}\n`);
        return 1;
      }
      await runCodexSession(projectRoot, { consultative: command.includes('--consultative') });
      return 0;
    }
    if (command.length === 1 && command[0] === 'agy') {
      const report = await diagnoseAgyRuntime(projectRoot);
      if (!report.ready) {
        process.stderr.write(`Sessão governada indisponível: ${report.reasons.join('; ')}\n`);
        return 1;
      }
      await runAgySession(projectRoot, { model });
      return 0;
    }
    if (command.length >= 1 && command[0] === 'opencode' && command.slice(1).every((arg) => arg === '--consultative')) {
      const report = await diagnoseOpencodeRuntime(projectRoot);
      if (!report.ready) {
        process.stderr.write(`Sessão governada indisponível: ${report.reasons.join('; ')}\n`);
        return 1;
      }
      await runOpencodeSession(projectRoot, { model, consultative: command.includes('--consultative'), prompt });
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
    if (command.length >= 1 && command[0] === 'benchmark') {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync('python3', ['-m', 'benchmark.controlled', ...command.slice(1)], {
        stdio: 'inherit',
      });
      return result.status ?? 0;
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
