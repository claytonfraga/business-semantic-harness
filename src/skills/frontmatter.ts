import type { SkillMetadata } from './types.js';

export function parseSkillFrontmatter(rawContent: string, fallbackName = 'unnamed-skill'): {
  metadata: SkillMetadata;
  body: string;
} {
  const trimmed = rawContent.trimStart();
  if (!trimmed.startsWith('---')) {
    // No frontmatter, extract first heading or fallback
    const firstLine = trimmed.split('\n')[0] || '';
    const headingMatch = firstLine.match(/^#+\s+(.+)$/);
    const name = headingMatch ? headingMatch[1].trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : fallbackName;
    return {
      metadata: {
        name,
        description: 'No description provided.',
      },
      body: rawContent.trim(),
    };
  }

  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    return {
      metadata: {
        name: fallbackName,
        description: 'No description provided.',
      },
      body: rawContent.trim(),
    };
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trim();

  const metadata: SkillMetadata = {
    name: fallbackName,
    description: 'No description provided.',
  };

  const lines = yamlBlock.split('\n');
  let currentKey = '';
  let multilineVal = '';
  let inMultiline = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    if (inMultiline) {
      if (/^[a-zA-Z0-9_-]+:/.test(trimmedLine)) {
        // End of multiline
        if (currentKey) {
          metadata[currentKey] = multilineVal.trim();
        }
        inMultiline = false;
        multilineVal = '';
      } else {
        multilineVal += (multilineVal ? ' ' : '') + trimmedLine;
        continue;
      }
    }

    const match = trimmedLine.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();

      if (val === '>' || val === '|' || val === '>-' || val === '|-') {
        currentKey = key;
        inMultiline = true;
        multilineVal = '';
        continue;
      }

      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      metadata[key] = val;
      if (key === 'name') metadata.name = val;
      if (key === 'description') metadata.description = val;
    }
  }

  if (inMultiline && currentKey) {
    metadata[currentKey] = multilineVal.trim();
    if (currentKey === 'name') metadata.name = multilineVal.trim();
    if (currentKey === 'description') metadata.description = multilineVal.trim();
  }

  return { metadata, body };
}
