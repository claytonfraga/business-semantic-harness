import type { Skill } from './types.js';

export interface SkillInvocationMatch {
  matchedSkill?: Skill;
  effectivePrompt: string;
  isSlashCommand: boolean;
}

/**
 * Detects whether a user prompt explicitly invokes a skill via slash syntax,
 * e.g., `/prototype create state machine` or `/skill prototype ...`
 */
export function detectSkillInvocation(prompt: string, availableSkills: Skill[]): SkillInvocationMatch {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith('/')) {
    return { effectivePrompt: trimmed, isSlashCommand: false };
  }

  // Case 1: /skill <name> <prompt>
  if (trimmed.startsWith('/skill ') || trimmed.startsWith('/skills ')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const candidateName = parts[1].toLowerCase();
      const matched = availableSkills.find((s) => s.name.toLowerCase() === candidateName);
      if (matched) {
        const effectivePrompt = parts.slice(2).join(' ').trim() || `Execute skill directives for ${matched.name}`;
        return {
          matchedSkill: matched,
          effectivePrompt,
          isSlashCommand: true,
        };
      }
    }
  }

  // Case 2: Direct slash command, e.g., /prototype <prompt>
  const firstWordMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
  if (firstWordMatch) {
    const commandName = firstWordMatch[1].toLowerCase();
    const matched = availableSkills.find((s) => s.name.toLowerCase() === commandName);
    if (matched) {
      const rest = (firstWordMatch[2] || '').trim();
      const effectivePrompt = rest || `Execute skill directives for ${matched.name}`;
      return {
        matchedSkill: matched,
        effectivePrompt,
        isSlashCommand: true,
      };
    }
  }

  return { effectivePrompt: trimmed, isSlashCommand: false };
}

/**
 * Heuristically inspects prompt text to detect if any available skill is strongly
 * requested (e.g. mentions 'prototype', 'throwaway prototype', 'protótipo').
 */
export function detectSemanticSkillNeed(prompt: string, availableSkills: Skill[]): Skill | undefined {
  const lower = prompt.toLowerCase();

  for (const skill of availableSkills) {
    const skillNameLower = skill.name.toLowerCase();
    const regex = new RegExp(`\\b${skillNameLower}\\b`, 'i');
    if (regex.test(lower)) {
      return skill;
    }
  }

  // Semantic aliases for prototype
  if (lower.includes('protótipo') || lower.includes('prototipo') || lower.includes('throwaway')) {
    const proto = availableSkills.find((s) => s.name.toLowerCase() === 'prototype');
    if (proto) return proto;
  }

  return undefined;
}
