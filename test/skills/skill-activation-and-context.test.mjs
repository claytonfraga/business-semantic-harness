import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry } from '../../dist/skills/registry.js';
import { detectSkillInvocation, detectSemanticSkillNeed } from '../../dist/skills/activation.js';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';

describe('Skills Dynamic Activation and Inclusion Unit Suite (Given/When/Then)', () => {
  it('Given uma pasta de projeto com skill prototype instalada, When descobre as skills, Then retorna a skill com escopo project', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'bsh-skill-act-'));
    try {
      const skillDir = join(tempDir, '.agents', 'skills', 'prototype');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: prototype\ndescription: Build a throwaway prototype to answer a design question.\n---\n\n# Prototype Guidelines\nA prototype is throwaway code that answers a question.\n1. Throwaway from day one.\n2. Trivial to run.`
      );

      const registry = new SkillRegistry(tempDir);
      const skills = await registry.discover({ projectRoot: tempDir, enableGlobal: false });

      assert.strictEqual(skills.length, 1);
      assert.strictEqual(skills[0].name, 'prototype');
      assert.strictEqual(skills[0].scope, 'project');
      assert.match(skills[0].description, /throwaway prototype/i);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Given uma invocação slash "/prototype crie a máquina de estados", When detectSkillInvocation é executado, Then identifica a skill e extrai o prompt efetivo', async () => {
    const fakeSkills = [
      {
        name: 'prototype',
        description: 'Build throwaway prototype',
        scope: 'project',
        filePath: '/mock/SKILL.md',
        directoryPath: '/mock',
        body: 'Do prototype',
        metadata: { name: 'prototype', description: 'desc' },
        associatedFiles: [],
      },
    ];

    const result = detectSkillInvocation('/prototype crie a máquina de estados', fakeSkills);

    assert.strictEqual(result.isSlashCommand, true);
    assert.ok(result.matchedSkill);
    assert.strictEqual(result.matchedSkill.name, 'prototype');
    assert.strictEqual(result.effectivePrompt, 'crie a máquina de estados');
  });

  it('Given comando "/skill prototype desenhar tela", When detectSkillInvocation é executado, Then identifica a skill e formata o prompt de ação', async () => {
    const fakeSkills = [
      {
        name: 'prototype',
        description: 'Build throwaway prototype',
        scope: 'project',
        filePath: '/mock/SKILL.md',
        directoryPath: '/mock',
        body: 'Do prototype',
        metadata: { name: 'prototype', description: 'desc' },
        associatedFiles: [],
      },
    ];

    const result = detectSkillInvocation('/skill prototype desenhar tela', fakeSkills);

    assert.strictEqual(result.isSlashCommand, true);
    assert.ok(result.matchedSkill);
    assert.strictEqual(result.matchedSkill.name, 'prototype');
    assert.strictEqual(result.effectivePrompt, 'desenhar tela');
  });

  it('Given uma solicitação em linguagem natural contendo "protótipo descartável", When detectSemanticSkillNeed é invocado, Then seleciona a skill prototype', () => {
    const fakeSkills = [
      {
        name: 'prototype',
        description: 'Build throwaway prototype',
        scope: 'project',
        filePath: '/mock/SKILL.md',
        directoryPath: '/mock',
        body: 'Do prototype',
        metadata: { name: 'prototype', description: 'desc' },
        associatedFiles: [],
      },
    ];

    const match = detectSemanticSkillNeed('Por favor elabore um protótipo descartável para testar a transição', fakeSkills);

    assert.ok(match);
    assert.strictEqual(match.name, 'prototype');
  });

  it('Given uma lista com a skill prototype ativa, When formatSkillsForPrompt é executado, Then injeta as diretivas completas no System Prompt', () => {
    const fakeSkills = [
      {
        name: 'prototype',
        description: 'Build a throwaway prototype to answer a design question.',
        scope: 'project',
        filePath: '/mock/SKILL.md',
        directoryPath: '/mock',
        body: '# Prototype Rules\n1. Throwaway from day one.\n2. Trivial to run.',
        metadata: { name: 'prototype', description: 'Build a throwaway prototype to answer a design question.' },
        associatedFiles: ['LOGIC.md'],
      },
    ];

    const registry = new SkillRegistry('/mock');
    const promptContext = registry.formatSkillsForPrompt(fakeSkills, ['prototype']);

    assert.match(promptContext, /## Available Agent Skills:/);
    assert.match(promptContext, /\[ACTIVE\]/);
    assert.match(promptContext, /## Active Skill Instructions:/);
    assert.match(promptContext, /### Skill Directives: prototype/);
    assert.match(promptContext, /1\. Throwaway from day one\./);
    assert.match(promptContext, /Associated resources available in.*LOGIC\.md/);
  });

  it('Given a ferramenta inspect_skill no WorkspaceToolExecutor, When executada para uma skill existente, Then retorna o conteúdo integral do SKILL.md', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'bsh-tool-skill-'));
    try {
      const skillDir = join(tempDir, '.agents', 'skills', 'prototype');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: prototype\ndescription: Throwaway prototype.\n---\n\nDiretrizes de Prototipação Rápida.`
      );

      const executor = new WorkspaceToolExecutor(tempDir, tempDir);
      const output = await executor.executeTool('inspect_skill', { name: 'prototype' });

      assert.match(output, /Skill: prototype \(project\)/);
      assert.match(output, /Diretrizes de Prototipação Rápida\./);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Given a ferramenta inspect_skill com nome não cadastrado, When executada, Then retorna aviso resiliente sem erro fatal', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'bsh-tool-skill-'));
    try {
      const executor = new WorkspaceToolExecutor(tempDir, tempDir);
      const output = await executor.executeTool('inspect_skill', { name: 'inexistente-xyz' });

      assert.match(output, /Skill "inexistente-xyz" was not found/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Given uma sessão com skill ativa, When renderHeader é executado, Then exibe o badge [⚡ ACTIVE] com o nome da skill', async () => {
    const { renderHeader } = await import('../../dist/tui/render.js');
    const headerOutput = renderHeader({
      model: 'deepseek/deepseek-v4.1-flash',
      domain: 'asset-management',
      governed: true,
      tokensTotal: 1200,
      activeSkill: 'prototype',
    }, 120);

    assert.match(headerOutput, /Skill:/);
    assert.match(headerOutput, /prototype/);
    assert.match(headerOutput, /ACTIVE/);
  });
});

