import { fuzzyScore } from './fuzzySearch.js';

export interface SlashCommandDef {
  name: string;
  description: string;
  shortcut?: string;
  category: 'Sistema' | 'Governança' | 'Configuração' | 'Skills' | 'Interface';
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: '/model',
    description: 'Navegar e alternar o modelo LLM do OpenRouter ativo via busca difusa',
    shortcut: 'Ctrl+M',
    category: 'Configuração',
  },
  {
    name: '/domain',
    description: 'Selecionar domínio ontológico e carregar shapes SHACL de governança',
    shortcut: 'Ctrl+D',
    category: 'Governança',
  },
  {
    name: '/skills',
    description: 'Explorar, instalar e gerenciar skills operacionais do ecossistema',
    category: 'Skills',
  },
  {
    name: '/diff',
    description: 'Revisar diff de alterações no workspace isolado e promover para a branch',
    category: 'Sistema',
  },
  {
    name: '/rules',
    description: 'Inspecionar regras SHACL e restrições ontológicas ativas no domínio',
    category: 'Governança',
  },
  {
    name: '/settings',
    description: 'Ajustar preferências da sessão (confirmação de violações, defaults)',
    category: 'Configuração',
  },
  {
    name: '/affinity',
    description: 'Diagnosticar afinidade semântica entre vocabulário ontológico e o projeto',
    category: 'Governança',
  },
  {
    name: '/mcp',
    description: 'Gerenciar conexões e ferramentas MCP (Model Context Protocol)',
    category: 'Sistema',
  },
  {
    name: '/clear',
    description: 'Limpar a tela da TUI e reiniciar o viewport de mensagens',
    category: 'Interface',
  },
  {
    name: '/done',
    description: 'Concluir formalmente o loop da skill ativa e consolidar entregáveis',
    category: 'Skills',
  },
  {
    name: '/help',
    description: 'Exibir comandos disponíveis, atalhos de teclado e documentação',
    category: 'Interface',
  },
  {
    name: '/ungoverned',
    description: 'Desativar temporariamente o harness ontológico (modo bypass sem SHACL)',
    category: 'Governança',
  },
  {
    name: '/governed',
    description: 'Reativar a governança ontológica estrita e validação de regras SHACL',
    category: 'Governança',
  },
  {
    name: '/exit',
    description: 'Encerrar a sessão do BSH com segurança e restaurar o terminal limpo',
    category: 'Sistema',
  },
];

export interface ScoredSlashCommand {
  command: SlashCommandDef;
  score: number;
  indices: number[];
}

export function filterSlashCommands(
  query: string,
  commands: SlashCommandDef[] = DEFAULT_SLASH_COMMANDS
): ScoredSlashCommand[] {
  const cleanQuery = query.trim().replace(/^\//, '').toLowerCase();

  if (!cleanQuery) {
    return commands.map((c) => ({ command: c, score: 0, indices: [] }));
  }

  const results: ScoredSlashCommand[] = [];

  for (const cmd of commands) {
    const rawCmdName = cmd.name.replace(/^\//, '').toLowerCase();
    
    // Exact prefix match gets high priority
    if (rawCmdName.startsWith(cleanQuery)) {
      results.push({
        command: cmd,
        score: 100 + (10 - rawCmdName.length),
        indices: Array.from({ length: cleanQuery.length }, (_, i) => i + 1), // skip '/'
      });
      continue;
    }

    // Fuzzy match on command name
    const nameMatch = fuzzyScore(cmd.name, query.startsWith('/') ? query : `/${query}`);
    if (nameMatch) {
      results.push({
        command: cmd,
        score: nameMatch.score,
        indices: nameMatch.indices,
      });
      continue;
    }

    // Fuzzy match on description
    const descMatch = fuzzyScore(cmd.description, cleanQuery);
    if (descMatch) {
      results.push({
        command: cmd,
        score: descMatch.score * 0.5,
        indices: [],
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
