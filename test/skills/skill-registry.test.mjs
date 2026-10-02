import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseSkillFrontmatter } from '../../dist/skills/frontmatter.js';
import { SkillRegistry } from '../../dist/skills/registry.js';
import { handleSkillCliCommand } from '../../dist/skills/cliCommand.js';

test('Given a raw SKILL.md with YAML frontmatter, When parseSkillFrontmatter is called, Then it extracts name, description and markdown body correctly', () => {
  const raw = `---
name: sample-skill
description: A helpful sample skill for testing
version: 1.0.0
---

# Sample Skill

Instructions go here.
`;

  const parsed = parseSkillFrontmatter(raw, 'fallback');
  assert.equal(parsed.metadata.name, 'sample-skill');
  assert.equal(parsed.metadata.description, 'A helpful sample skill for testing');
  assert.ok(parsed.body.includes('# Sample Skill'));
  assert.ok(parsed.body.includes('Instructions go here.'));
});

test('Given a raw SKILL.md without YAML frontmatter, When parseSkillFrontmatter is called, Then it falls back gracefully without throwing', () => {
  const raw = `# Plain Skill

Direct instructions without frontmatter.
`;

  const parsed = parseSkillFrontmatter(raw, 'plain-fallback');
  assert.equal(parsed.metadata.name, 'plain-skill');
  assert.equal(parsed.metadata.description, 'No description provided.');
  assert.ok(parsed.body.includes('# Plain Skill'));
});

test('Given a SkillRegistry for this project, When discover is called, Then it scans project roots and discovers the installed prototype skill', async () => {
  const projectRoot = resolve(process.cwd());
  const registry = new SkillRegistry(projectRoot);
  const skills = await registry.discover();

  assert.ok(skills.length > 0, 'Should discover skills');
  const prototypeSkill = skills.find((s) => s.name === 'prototype');
  assert.ok(prototypeSkill, 'Should find prototype skill');
  assert.equal(prototypeSkill.scope, 'project');
  assert.ok(prototypeSkill.description.includes('prototype'));
});

test('Given the prototype skill in .agents/skills/prototype, When get(\'prototype\') is called, Then it returns the skill with scope project and associated files', async () => {
  const projectRoot = resolve(process.cwd());
  const registry = new SkillRegistry(projectRoot);
  const skill = await registry.get('prototype');

  assert.ok(skill, 'Skill prototype should exist');
  assert.equal(skill.name, 'prototype');
  assert.equal(skill.scope, 'project');
  assert.ok(skill.associatedFiles.includes('LOGIC.md') || skill.associatedFiles.includes('UI.md'));
  assert.ok(skill.body.includes('throwaway code that answers a question'));
});

test('Given a list of skills and active skills, When formatSkillsForPrompt is called, Then it formats available skills and injects active skill instructions', async () => {
  const projectRoot = resolve(process.cwd());
  const registry = new SkillRegistry(projectRoot);
  const skills = await registry.discover();

  const promptOutput = registry.formatSkillsForPrompt(skills, ['prototype']);

  assert.ok(promptOutput.includes('## Available Agent Skills:'));
  assert.ok(promptOutput.includes('- **prototype** (project):'));
  assert.ok(promptOutput.includes('[ACTIVE]'));
  assert.ok(promptOutput.includes('## Active Skill Instructions:'));
  assert.ok(promptOutput.includes('### Skill Directives: prototype'));
  assert.ok(promptOutput.includes('throwaway code that answers a question'));
});

test('Given handleSkillCliCommand with show prototype, When executed, Then it outputs skill details and returns exit code 0', async () => {
  const projectRoot = resolve(process.cwd());

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += chunk.toString();
    return true;
  };

  try {
    const code = await handleSkillCliCommand(['show', 'prototype'], projectRoot);
    assert.equal(code, 0);
    assert.ok(output.includes('Skill: prototype (project)'));
    assert.ok(output.includes('Instruções da Skill'));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('Given handleSkillCliCommand with unknown subcommand, When executed, Then it prints error and returns exit code 2', async () => {
  const projectRoot = resolve(process.cwd());

  let errOutput = '';
  const originalErr = process.stderr.write;
  process.stderr.write = (chunk) => {
    errOutput += chunk.toString();
    return true;
  };

  try {
    const code = await handleSkillCliCommand(['invalid-action'], projectRoot);
    assert.equal(code, 2);
    assert.ok(errOutput.includes('Subcomando inválido'));
  } finally {
    process.stderr.write = originalErr;
  }
});
