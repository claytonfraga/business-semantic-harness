import { loadEnvConfig } from '../config/env.js';
import {
  deleteUserAuth,
  getAuthFilePath,
  maskApiKey,
  loadUserAuth,
} from '../config/userStore.js';
import { ansi } from '../tui/ansi.js';

export async function handleAuthCommand(args: string[], projectRoot: string = process.cwd()): Promise<number> {
  const subCommand = args[0] || 'status';

  if (subCommand === 'status') {
    const env = await loadEnvConfig(projectRoot);
    const userAuth = await loadUserAuth();

    if (!env.openRouterApiKey) {
      process.stdout.write(
        `${ansi.yellow}Status:${ansi.reset} Unauthenticated\n` +
        `${ansi.dim}Credential store:${ansi.reset} ${getAuthFilePath()} (absent)\n` +
        `Run '${ansi.cyan}bsh auth login${ansi.reset}' to authenticate.\n`
      );
      return 0;
    }

    let sourceDesc = 'User credential store';
    if (env.apiKeySource === 'env') {
      sourceDesc = 'Environment variable (OPENROUTER_API_KEY)';
    } else if (env.apiKeySource === 'file') {
      sourceDesc = 'Project local file (.env)';
    }

    process.stdout.write(
      `${ansi.brightGreen}Status:${ansi.reset} Authenticated\n` +
      `${ansi.bold}Source:${ansi.reset} ${sourceDesc}\n` +
      `${ansi.bold}Key:${ansi.reset} ${maskApiKey(env.openRouterApiKey)}\n` +
      `${ansi.dim}Credential store:${ansi.reset} ${getAuthFilePath()}${userAuth.apiKey ? ' (present)' : ' (empty)'}\n`
    );
    return 0;
  }

  if (subCommand === 'logout') {
    const deleted = await deleteUserAuth();
    if (deleted) {
      process.stdout.write(`${ansi.brightGreen}Credential removed from the user store.${ansi.reset}\n`);
    } else {
      process.stdout.write(`${ansi.yellow}No credential found in the user store (${getAuthFilePath()}).${ansi.reset}\n`);
    }
    return 0;
  }

  if (subCommand === 'login') {
    if (process.stdin.isTTY && !('Bun' in globalThis)) {
      const { launchAuth } = await import('../tui/runtime.js');
      return launchAuth(args.includes('--manual'));
    }
    try {
      const { promptApiKeyModal } = await import('../tui/modals.js');
      await promptApiKeyModal(undefined, args.includes('--manual'));
      process.stdout.write(`Credential saved in ${getAuthFilePath()}.\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`Authentication failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  process.stderr.write(
    `Unknown authentication subcommand: '${subCommand}'. Use 'bsh auth login', 'bsh auth status' or 'bsh auth logout'.\n`
  );
  return 2;
}
