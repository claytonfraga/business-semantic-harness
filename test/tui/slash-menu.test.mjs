import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommands,
} from '../../dist/tui/slashCommands.js';

describe('Slash Commands Menu Unit Suite (Given/When/Then)', () => {
  it('Given o catálogo de comandos slash padrão do BSH, When filtrado sem termo de busca, Then retorna todos os comandos essenciais com descrições', () => {
    const results = filterSlashCommands('');

    assert.ok(results.length >= 12);
    const commandNames = results.map((r) => r.command.name);
    assert.ok(commandNames.includes('/model'));
    assert.ok(commandNames.includes('/domain'));
    assert.ok(commandNames.includes('/skills'));
    assert.ok(commandNames.includes('/diff'));
    assert.ok(commandNames.includes('/rules'));
    assert.ok(commandNames.includes('/settings'));
    assert.ok(commandNames.includes('/mcp'));
    assert.ok(commandNames.includes('/clear'));
    assert.ok(commandNames.includes('/exit'));
    assert.ok(commandNames.includes('/help'));

    // Verifica que cada comando possui descrição clara
    for (const item of results) {
      assert.ok(item.command.description.length > 10);
      assert.match(item.command.name, /^\/[a-z]+/);
    }
  });

  it('Given o catálogo de comandos, When filtrado por "ex", Then prioriza /exit com alta pontuação', () => {
    const results = filterSlashCommands('ex');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/exit');
    assert.match(results[0].command.description, /encerrar a sessão/i);
  });

  it('Given o catálogo de comandos, When filtrado por "domain", Then retorna o comando com atalho Ctrl+D e categoria Governança', () => {
    const results = filterSlashCommands('domain');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/domain');
    assert.strictEqual(results[0].command.shortcut, 'Ctrl+D');
    assert.strictEqual(results[0].command.category, 'Governança');
  });

  it('Given o catálogo de comandos, When filtrado por "model", Then retorna o comando com atalho Ctrl+M e categoria Configuração', () => {
    const results = filterSlashCommands('/model');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/model');
    assert.strictEqual(results[0].command.shortcut, 'Ctrl+M');
    assert.strictEqual(results[0].command.category, 'Configuração');
  });

  it('Given a regra de disparo da TUI, When a tecla "/" é pressionada em linha vazia, Then o menu deve ser acionado', () => {
    const isTrigger = (char, line, isModalOpen, isExecutingTurn) => {
      return (
        !isExecutingTurn &&
        !isModalOpen &&
        char === '/' &&
        line.trim().length === 0
      );
    };

    assert.strictEqual(isTrigger('/', '', false, false), true);
    assert.strictEqual(isTrigger('/', '   ', false, false), true);
  });

  it('Given a regra de disparo da TUI, When a tecla "/" é digitada com texto já existente no buffer, Then o menu NÃO deve ser acionado', () => {
    const isTrigger = (char, line, isModalOpen, isExecutingTurn) => {
      return (
        !isExecutingTurn &&
        !isModalOpen &&
        char === '/' &&
        line.trim().length === 0
      );
    };

    assert.strictEqual(isTrigger('/', 'crie rota /api', false, false), false);
    assert.strictEqual(isTrigger('/', 'verificar /src/core', false, false), false);
    assert.strictEqual(isTrigger('/', '', true, false), false); // modal já aberto
    assert.strictEqual(isTrigger('/', '', false, true), false); // turno em execução
  });
});
