import * as readline from 'node:readline/promises';
import { loadEnvConfig } from '../config/env.js';
import {
  saveUserAuth,
  deleteUserAuth,
  getAuthFilePath,
  maskApiKey,
  loadUserAuth,
} from '../config/userStore.js';
import { authenticateViaWebBrowser, openBrowser } from '../client/openrouter/pkce.js';
import { ansi, box } from '../tui/ansi.js';

export async function handleAuthCommand(args: string[], projectRoot: string = process.cwd()): Promise<number> {
  const subCommand = args[0] || 'status';

  if (subCommand === 'status') {
    const env = await loadEnvConfig(projectRoot);
    const userAuth = await loadUserAuth();

    if (!env.openRouterApiKey) {
      process.stdout.write(
        `${ansi.yellow}Status:${ansi.reset} Não autenticado\n` +
        `${ansi.dim}Cofre Global:${ansi.reset} ${getAuthFilePath()} (ausente)\n` +
        `Execute '${ansi.cyan}bsh auth login${ansi.reset}' para autenticar.\n`
      );
      return 0;
    }

    let sourceDesc = 'Cofre Global do Usuário';
    if (env.apiKeySource === 'env') {
      sourceDesc = 'Variável de ambiente (OPENROUTER_API_KEY)';
    } else if (env.apiKeySource === 'file') {
      sourceDesc = 'Arquivo local do projeto (.env)';
    }

    process.stdout.write(
      `${ansi.brightGreen}Status:${ansi.reset} Autenticado\n` +
      `${ansi.bold}Origem:${ansi.reset} ${sourceDesc}\n` +
      `${ansi.bold}Chave:${ansi.reset} ${maskApiKey(env.openRouterApiKey)}\n` +
      `${ansi.dim}Cofre Global:${ansi.reset} ${getAuthFilePath()}${userAuth.apiKey ? ' (presente)' : ' (vazio)'}\n`
    );
    return 0;
  }

  if (subCommand === 'logout') {
    const deleted = await deleteUserAuth();
    if (deleted) {
      process.stdout.write(`${ansi.brightGreen}Credencial removida com sucesso do cofre global.${ansi.reset}\n`);
    } else {
      process.stdout.write(`${ansi.yellow}Nenhuma credencial encontrada no cofre global (${getAuthFilePath()}).${ansi.reset}\n`);
    }
    return 0;
  }

  if (subCommand === 'login') {
    const manualFlag = args.includes('--manual');

    if (manualFlag) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const key = (await rl.question(`${ansi.bold}Informe a API Key do OpenRouter: ${ansi.reset}`)).trim();
        if (!key) {
          process.stderr.write(`${ansi.red}Chave inválida ou vazia. Operação cancelada.${ansi.reset}\n`);
          return 1;
        }
        await saveUserAuth({ apiKey: key });
        process.stdout.write(`${ansi.brightGreen}Credencial salva com sucesso em ${getAuthFilePath()}.${ansi.reset}\n`);
        return 0;
      } finally {
        rl.close();
      }
    }

    // Default Web PKCE Login
    process.stdout.write(`${ansi.dim}Iniciando servidor de autenticação local (OAuth/PKCE)...${ansi.reset}\n`);

    try {
      const result = await authenticateViaWebBrowser({
        onUrlReady: (url) => {
          process.stdout.write(
            `\n${box('Autenticação OpenRouter no Navegador', [
              'Abrindo navegador para autorizar o BSH...',
              '',
              'Caso o navegador não abra automaticamente, acesse a URL:',
              `  ${ansi.cyan}${url}${ansi.reset}`,
              '',
              `A credencial será salva com segurança em:`,
              `  ${ansi.dim}${getAuthFilePath()}${ansi.reset}`,
            ], 76)}\n\n`
          );
          openBrowser(url);
        },
      });

      await saveUserAuth({ apiKey: result.apiKey });
      process.stdout.write(
        `\n${ansi.brightGreen}✔ Autenticado com sucesso!${ansi.reset}\n` +
        `Credencial salva no cofre do usuário: ${ansi.dim}${getAuthFilePath()}${ansi.reset}\n`
      );
      return 0;
    } catch (err: unknown) {
      process.stderr.write(
        `${ansi.red}Falha na autenticação via navegador: ${err instanceof Error ? err.message : String(err)}${ansi.reset}\n`
      );
      return 1;
    }
  }

  process.stderr.write(
    `Subcomando de autenticação desconhecido: '${subCommand}'. Use 'bsh auth login', 'bsh auth status' ou 'bsh auth logout'.\n`
  );
  return 2;
}
