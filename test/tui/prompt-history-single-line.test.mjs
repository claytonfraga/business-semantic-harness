import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompleteTui } from '../../dist/tui/render.js';

test('TUI render: prompt input line is always strictly 1 single line and never breaks frame height', () => {
  const width = 88;
  const height = 24;

  const prompts = [
    'prompt curto',
    'faça um endpoint pra remover um ativo nao baixado',
    'um prompt extraordinariamente longo que ultrapassa facilmente a largura total do terminal sem quebrar a moldura nem duplicar linhas de comando no terminal',
    '',
    'outro comando',
  ];

  for (const p of prompts) {
    const frame = renderCompleteTui(
      {
        model: 'deepseek/deepseek-v4.1-flash',
        governed: true,
        tokensTotal: 1500,
        width,
        height,
      },
      [],
      p,
      width,
      height
    );

    const lines = frame.split('\n');
    assert.equal(lines.length, height, `Altura deve ser exatamente ${height} linhas, independente do prompt`);

    // Procura a linha de prompt
    const promptLines = lines.filter((l) => l.includes('▎') && l.includes('>'));
    assert.equal(promptLines.length, 1, 'Deve existir estritamente UMA linha de prompt no frame');
  }
});
