import { fuzzyScore } from './fuzzySearch.js';

export interface SlashCommandDef {
  name: string;
  description: string;
  shortcut?: string;
  category: 'Sistema' | 'Governança' | 'Configuração' | 'Skills' | 'Interface';
  activeColor: string;
  activeColorName: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: '/model',
    description: 'Navegar e alternar o modelo LLM do OpenRouter ativo via busca difusa',
    shortcut: 'Ctrl+M',
    category: 'Configuração',
    activeColor: '\x1b[1;38;5;177m',
    activeColorName: 'Magenta',
  },
  {
    name: '/domain',
    description: 'Selecionar domínio ontológico e carregar shapes SHACL de governança',
    shortcut: 'Ctrl+D',
    category: 'Governança',
    activeColor: '\x1b[1;38;5;48m',
    activeColorName: 'Verde Esmeralda',
  },
  {
    name: '/skills',
    description: 'Explorar, instalar e gerenciar skills operacionais do ecossistema',
    category: 'Skills',
    activeColor: '\x1b[1;38;5;51m',
    activeColorName: 'Ciano Elétrico',
  },
  {
    name: '/diff',
    description: 'Revisar diff de alterações no workspace isolado e promover para a branch',
    category: 'Sistema',
    activeColor: '\x1b[1;38;5;220m',
    activeColorName: 'Amarelo Dourado',
  },
  {
    name: '/rules',
    description: 'Inspecionar regras SHACL e restrições ontológicas ativas no domínio',
    category: 'Governança',
    activeColor: '\x1b[1;38;5;75m',
    activeColorName: 'Azul Céu',
  },
  {
    name: '/settings',
    description: 'Ajustar preferências da sessão (confirmação de violações, defaults)',
    category: 'Configuração',
    activeColor: '\x1b[1;38;5;208m',
    activeColorName: 'Laranja Pêssego',
  },
  {
    name: '/affinity',
    description: 'Diagnosticar afinidade semântica entre vocabulário ontológico e o projeto',
    category: 'Governança',
    activeColor: '\x1b[1;38;5;43m',
    activeColorName: 'Turquesa',
  },
  {
    name: '/mcp',
    description: 'Gerenciar conexões e ferramentas MCP (Model Context Protocol)',
    category: 'Sistema',
    activeColor: '\x1b[1;38;5;141m',
    activeColorName: 'Violeta',
  },
  {
    name: '/clear',
    description: 'Limpar a tela da TUI e reiniciar o viewport de mensagens',
    category: 'Interface',
    activeColor: '\x1b[1;38;5;253m',
    activeColorName: 'Prata Brilhante',
  },
  {
    name: '/done',
    description: 'Concluir formalmente o loop da skill ativa e consolidar entregáveis',
    category: 'Skills',
    activeColor: '\x1b[1;38;5;154m',
    activeColorName: 'Verde Limão',
  },
  {
    name: '/help',
    description: 'Exibir comandos disponíveis, atalhos de teclado e documentação',
    category: 'Interface',
    activeColor: '\x1b[1;38;5;39m',
    activeColorName: 'Azul Royal',
  },
  {
    name: '/ungoverned',
    description: 'Desativar temporariamente o harness ontológico (modo bypass sem SHACL)',
    category: 'Governança',
    activeColor: '\x1b[1;38;5;209m',
    activeColorName: 'Âmbar Quente',
  },
  {
    name: '/governed',
    description: 'Reativar a governança ontológica estrita e validação de regras SHACL',
    category: 'Governança',
    activeColor: '\x1b[1;38;5;49m',
    activeColorName: 'Menta',
  },
  {
    name: '/exit',
    description: 'Encerrar a sessão do BSH com segurança e restaurar o terminal limpo',
    category: 'Sistema',
    activeColor: '\x1b[1;38;5;196m',
    activeColorName: 'Carmesim',
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

export function getSlashCommandActiveColor(name: string): string {
  const normalized = name.startsWith('/') ? name.toLowerCase() : `/${name.toLowerCase()}`;
  const found = DEFAULT_SLASH_COMMANDS.find((c) => c.name.toLowerCase() === normalized);
  return found?.activeColor || '\x1b[1;38;5;51m';
}

export function formatSlashCommandLine(
  command: SlashCommandDef,
  index: number,
  isActive: boolean,
  highlightedName?: string
): string {
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const magenta = '\x1b[35m';

  const pointer = isActive ? `${command.activeColor}❯${reset} ` : '  ';
  const numBadge = `${bold}${index + 1}.${reset}`;
  const nameStr = isActive
    ? `${command.activeColor}${command.name}${reset}`
    : (highlightedName || `${dim}${command.name}${reset}`);
  const shortcutBadge = command.shortcut ? ` ${dim}[${command.shortcut}]${reset}` : '';
  const categoryBadge = isActive
    ? ` ${command.activeColor}(${command.category})${reset}`
    : ` ${magenta}(${command.category})${reset}`;
  const descStr = isActive ? `${bold}${command.description}${reset}` : `${dim}${command.description}${reset}`;

  return `${pointer}${numBadge} ${nameStr}${shortcutBadge}${categoryBadge} - ${descStr}`;
}
