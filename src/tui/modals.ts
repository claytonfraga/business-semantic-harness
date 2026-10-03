import * as readline from 'node:readline/promises';
import type { OpenRouterModel } from '../client/openrouter/types.js';
import type { DomainSummary } from '../governance/domainRegistry.js';
import type { Skill } from '../skills/types.js';
import { authenticateViaWebBrowser, openBrowser } from '../client/openrouter/pkce.js';
import { saveUserAuth, getAuthFilePath } from '../config/userStore.js';
import { getActiveDialogHost, type DialogHost, type SelectionDialog } from './dialogs.js';
import { fuzzyScore, searchModels } from './fuzzySearch.js';
import { DEFAULT_SLASH_COMMANDS, filterSlashCommands, type SlashCommandDef } from './slashCommands.js';
export { fuzzyScore, highlightMatches, searchModels, type FuzzyMatchResult } from './fuzzySearch.js';
export interface AuthResult { apiKey: string; ephemeral: boolean }

async function withHost<T>(host: DialogHost | undefined, run: (host: DialogHost) => Promise<T>): Promise<T> {
  const shared = host ?? getActiveDialogHost();
  if (shared) return run(shared);
  if (!process.stdin.isTTY) return run(textHost());
  const { createTuiView } = await import('./view.js');
  const view = await createTuiView();
  try { return await run(view); } finally { view.destroy(); }
}
/** Plain line protocol deliberately never loads OpenTUI or prints frames. */
function textHost(): DialogHost {
  async function question(title: string, message: string, signal?: AbortSignal): Promise<string | null> {
    console.log(`${title}\n${message}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await rl.question('> ', { signal }); } catch { return null; } finally { rl.close(); }
  }
  return {
    dialogActive: false,
    async question(options) { return question(options.title, options.message, options.signal); },
    async notice(title, content) { await question(title, content); },
    async select<T>(options: SelectionDialog<T>): Promise<T | null> {
      let query = options.initialQuery ?? '';
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const lines = rl[Symbol.asyncIterator]();
      try {
        while (true) {
          const items = options.filter ? options.filter(query) : options.items.filter(item => fuzzyScore(`${item.label} ${item.description ?? ''}`, query));
          console.log(`${options.title}\n${items.map((item,index) => `${index+1}. ${item.label}${item.description ? ` — ${item.description}` : ''}`).join('\n') || 'No match'}\nNumber, exact identifier, search, or q to close`);
          const next = await lines.next();
          const answer = next.done ? '' : next.value.trim();
          if (!answer || /^(q|cancel|exit)$/i.test(answer) && !options.items.some(item => item.label === `/${answer}`)) return null;
          if (/^[1-9]\d*$/.test(answer) && items[Number(answer)-1]) return items[Number(answer)-1].value;
          const custom = options.onQuerySubmit?.(answer, items);
          if (custom !== undefined) return custom;
          const exact = options.items.find(item => item.label.toLowerCase() === answer.toLowerCase());
          if (exact) return exact.value;
          query = answer;
        }
      } finally { rl.close(); }

    },
  };
}

export async function promptApiKeyModal(host?: DialogHost, manualOnly = false): Promise<AuthResult> {
  return withHost(host, async shared => {
    const webAbort = new AbortController();
    let inputAbort = new AbortController();
    let message = `Paste your OpenRouter API key or authorize in your browser.\nCredential store: ${getAuthFilePath()}`;
    let ready: (() => void) | undefined;
    const urlReady = new Promise<void>(resolve => { ready = resolve; });
    const web = manualOnly ? undefined : authenticateViaWebBrowser({ signal: webAbort.signal, onUrlReady(url) { message += `\nAuthorization URL: ${url}`; openBrowser(url); ready?.(); } }).then(result => ({ kind: 'key' as const, key: result.apiKey }), () => ({ kind: 'failed' as const }));
    if (web) await Promise.race([urlReady, web]);
    const manual = (async () => {
      while (true) {
        const key = await shared.question({ title: 'OpenRouter authentication', message, secret: true, signal: inputAbort.signal });
        if (key === null || key.trim() || manualOnly) return { kind: 'manual' as const, key };
        message = `${message}\nWaiting for browser authorization; paste a key or press Escape to cancel.`;
      }
    })();
    try {
      let winner = web ? await Promise.race([web, manual]) : await manual;
      if (winner.kind === 'failed') {
        inputAbort.abort(); await manual; inputAbort = new AbortController();
        const key = await shared.question({ title: 'Browser authentication failed', message: `Browser authentication could not finish. Paste an API key or press Escape to cancel.\nCredential store: ${getAuthFilePath()}`, secret: true, signal: inputAbort.signal });
        winner = { kind: 'manual', key };
      }
      if (winner.kind === 'manual' && winner.key === null) throw new Error('Authentication cancelled');
      if (winner.kind === 'manual' && !winner.key?.trim()) {
        if (!web) throw new Error('Empty API key; authentication cancelled');
        const result = await web;
        if (result.kind !== 'key') throw new Error('Browser authentication failed');
        winner = result;
      }
      if (!('key' in winner) || !winner.key) throw new Error('Authentication failed');
      const apiKey = winner.key.trim();
      inputAbort.abort(); webAbort.abort();
      await saveUserAuth({ apiKey });
      return { apiKey, ephemeral: false };
    } finally { inputAbort.abort(); webAbort.abort(); }
  });
}

export async function selectModelModal(models: OpenRouterModel[], currentModel: string, initialQuery?: string, host?: DialogHost): Promise<string> {
  const popularIds = ['deepseek/deepseek-v4.1-flash','deepseek/deepseek-chat','deepseek/deepseek-r1','anthropic/claude-3.5-sonnet','openai/gpt-4o','openai/gpt-4o-mini','qwen/qwen-2.5-coder-32b-instruct','meta-llama/llama-3.3-70b-instruct','google/gemini-2.0-flash-001'];
  const item = (model: OpenRouterModel) => ({ label: model.id, value: model.id, description: `${model.name ?? model.id}${model.context_length ? ` · ${Math.round(model.context_length / 1024)}k context` : ''}${model.id === currentModel ? ' · current' : ''}${model.pricing ? ` · Prompt: $${model.pricing.prompt}/token · Completion: $${model.pricing.completion}/token` : ''}` });
  const popular = models.filter(model => popularIds.includes(model.id));
  return withHost(host, async shared => await shared.select({ title: 'Select OpenRouter model', currentSelection: currentModel, initialQuery, items: models.map(item), cancelWords: true, cancelOnEmpty: true, filter: query => (query ? searchModels(models,query,12) : (popular.length ? popular : models).slice(0,10)).map(item) }) ?? currentModel);
}
export async function selectDomainModal(domains: DomainSummary[], currentDomain?: string, host?: DialogHost): Promise<string | undefined> {
  return withHost(host, async shared => {
    if (!domains.length) { await shared.notice('No domains available', 'No domains found in .bsh/domains/. BSH will run in UNGOVERNED mode. Run bsh domain add <name>.'); return undefined; }
    return await shared.select({ title: 'Select business domain', currentSelection: currentDomain, cancelOnEmpty: true, cancelWords: true, items: domains.map(domain => ({ label: domain.id, value: domain.id, description: `${domain.classesCount} classes · ${domain.shapesCount} SHACL shapes${domain.description ? ` · ${domain.description}` : ''}` })) }) ?? currentDomain ?? domains[0].id;
  });
}
export async function diffReviewModal(diffText: string, conforms: boolean, violations: string[] = [], host?: DialogHost): Promise<boolean> {
  return withHost(host, async shared => {
    if (!diffText.trim()) { await shared.notice('Workspace diff', 'No modified files detected in the session workspace.'); return false; }
    if (!conforms) { await shared.notice('BLOCKED BY SEMANTIC GATE', `${diffText}\n\n${violations.join('\n')}\nCannot promote while domain rules are violated.`); return false; }
    const answer = await shared.question({ title: 'Workspace diff · Semantic gate passed', message: `${diffText}\n\nPromote this change to the primary branch? [y/N]` });
    return answer?.trim().toLowerCase() === 'y';
  });
}
export interface SettingsState { confirmPromptViolations: boolean; model: string; domain?: string }
export async function settingsModal(currentSettings: SettingsState, host?: DialogHost): Promise<SettingsState> {
  return withHost(host, async shared => {
    const answer = await shared.select({ title: 'BSH settings', items: [{ label: 'Toggle prompt violation confirmation', value: 'toggle', description: `${currentSettings.confirmPromptViolations ? 'ENABLED' : 'DISABLED'} · Model: ${currentSettings.model} · Domain: ${currentSettings.domain ?? 'none'}` }, { label: 'Save and return', value: 'close' }] });
    return answer === 'toggle' ? { ...currentSettings, confirmPromptViolations: !currentSettings.confirmPromptViolations } : currentSettings;
  });
}
export async function selectSkillModal(skills: Skill[], activeSkills: string[] = [], initialQuery?: string, host?: DialogHost): Promise<{ selectedSkillName?: string; action: 'toggle' | 'show' | 'close' }> {
  return withHost(host, async shared => {
    const result = await shared.select<{ selectedSkillName: string; action: 'toggle' | 'show' }>({ title: 'BSH skills · Enter/number: toggle · /show N: details', initialQuery, cancelOnEmpty: true, cancelWords: true, items: skills.map(skill => ({ label: skill.name, value: { selectedSkillName: skill.name, action: 'toggle' as const }, description: `${skill.scope} · ${activeSkills.includes(skill.name) ? 'ACTIVE · ' : ''}${skill.description}` })),
      filter: query => skills.map(skill => ({ skill, match: fuzzyScore(skill.name,query.startsWith('/show ') ? '' : query) })).filter(row => row.match).sort((a,b) => (b.match?.score ?? 0)-(a.match?.score ?? 0)).slice(0,15).map(({skill}) => ({ label: skill.name, value: { selectedSkillName: skill.name, action: 'toggle' as const }, description: `${skill.scope} · ${activeSkills.includes(skill.name) ? 'ACTIVE · ' : ''}${skill.description}` })),
      onQuerySubmit: (query, items) => { const show = /^\/show ([1-9]\d*)$/.exec(query); return show && items[Number(show[1])-1] ? { ...items[Number(show[1])-1].value, action: 'show' as const } : undefined; },
    });
    return result ?? { action: 'close' };
  });
}
export async function selectSlashCommandModal(commands: SlashCommandDef[] = DEFAULT_SLASH_COMMANDS, initialQuery = '', host?: DialogHost): Promise<string | null> {
  const item = (command: SlashCommandDef) => ({ label: command.name, value: command.name, color: command.activeColor, description: `${command.shortcut ? `[${command.shortcut}] · ` : ''}${command.description}` });
  return withHost(host, shared => shared.select({ title: 'Slash commands', immediateNumeric: true, pageSize: 5, initialQuery, cancelBackspace: true, cancelWords: true, items: commands.map(item), filter: query => filterSlashCommands(query,commands).map(({command}) => item(command)), onQuerySubmit: query => commands.find(command => command.name.toLowerCase() === (query.startsWith('/') ? query : `/${query}`).toLowerCase())?.name }));
}
