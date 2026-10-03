import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommands,
} from '../../dist/tui/slashCommands.js';

describe('Slash Commands Menu Unit Suite (Given/When/Then)', () => {
  it('Given BSH-MENU-001 default commands When filtering without a query Then all commands and descriptions are available', () => {
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

    for (const item of results) {
      assert.ok(item.command.description.length > 10);
      assert.match(item.command.name, /^\/[a-z]+/);
    }
  });

  it('Given BSH-MENU-003 commands When searching ex Then exit ranks first', () => {
    const results = filterSlashCommands('ex');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/exit');
    assert.match(results[0].command.description, /safely exit/i);
  });

  it('Given BSH-MENU-003 commands When searching domain Then its shortcut and category remain available', () => {
    const results = filterSlashCommands('domain');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/domain');
    assert.strictEqual(results[0].command.shortcut, 'Ctrl+D');
    assert.strictEqual(results[0].command.category, 'Governance');
  });

  it('Given BSH-MENU-003 commands When searching model Then its shortcut and category remain available', () => {
    const results = filterSlashCommands('/model');

    assert.ok(results.length > 0);
    assert.strictEqual(results[0].command.name, '/model');
    assert.strictEqual(results[0].command.shortcut, 'Ctrl+M');
    assert.strictEqual(results[0].command.category, 'Config');
  });

  it('Given BSH-MENU-004 commands When inspecting active colors Then each uses its distinct theme accent', () => {
    const activeColors = DEFAULT_SLASH_COMMANDS.map((c) => c.activeColor);
    const uniqueColors = new Set(activeColors);

    assert.strictEqual(uniqueColors.size, DEFAULT_SLASH_COMMANDS.length);

    const modelCmd = DEFAULT_SLASH_COMMANDS.find((c) => c.name === '/model');
    const domainCmd = DEFAULT_SLASH_COMMANDS.find((c) => c.name === '/domain');
    const exitCmd = DEFAULT_SLASH_COMMANDS.find((c) => c.name === '/exit');

    assert.equal(modelCmd.activeColor, '#b083f0');
    assert.equal(domainCmd.activeColor, '#57ab5a');
    assert.equal(exitCmd.activeColor, '#f47067');

    assert.notStrictEqual(modelCmd.activeColor, domainCmd.activeColor);
    assert.notStrictEqual(domainCmd.activeColor, exitCmd.activeColor);
  });

});
