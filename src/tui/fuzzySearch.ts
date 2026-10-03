import type { OpenRouterModel } from '../client/openrouter/types.js';

export interface FuzzyMatchResult {
  score: number;
  indices: number[];
}

/**
 * Calculates a match score and matching character indices between a query and a target string.
 * Supports token-based permutation and word boundary bonuses.
 */
export function fuzzyScore(target: string, query: string): FuzzyMatchResult | null {
  const cleanTarget = target.toLowerCase();
  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) return { score: 1, indices: [] };

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  let totalScore = 0;
  const allIndices = new Set<number>();

  for (const token of tokens) {
    let pIdx = 0;
    let tokenScore = 0;
    let consecutiveBonus = 0;
    const tokenIndices: number[] = [];

    for (let tIdx = 0; tIdx < cleanTarget.length && pIdx < token.length; tIdx++) {
      if (cleanTarget[tIdx] === token[pIdx]) {
        tokenIndices.push(tIdx);
        tokenScore += 10;

        // Word boundary bonus: start of string or after separator
        if (tIdx === 0 || ['/', '-', '_', '.', ' ', ':'].includes(target[tIdx - 1])) {
          tokenScore += 25;
        }

        // Consecutive match bonus
        if (consecutiveBonus > 0) {
          tokenScore += consecutiveBonus * 15;
        }
        consecutiveBonus++;
        pIdx++;
      } else {
        consecutiveBonus = 0;
      }
    }

    if (pIdx < token.length) {
      return null;
    }

    totalScore += tokenScore;
    for (const idx of tokenIndices) {
      allIndices.add(idx);
    }
  }

  // Length penalty to prefer tighter/shorter matches
  totalScore -= Math.min(20, Math.floor(target.length / 5));

  return {
    score: totalScore,
    indices: Array.from(allIndices).sort((a, b) => a - b),
  };
}

/** Plain match indication for textual protocols; native widgets use styled spans. */
export function highlightMatches(text: string, indices: number[]): string {
  const selected = new Set(indices);
  return Array.from(text).map((char, index) => selected.has(index) ? `[${char}]` : char).join('');
}

/**
 * Filters and ranks models by relevance against a search query using fuzzy matching.
 */
export function searchModels(
  models: OpenRouterModel[],
  query: string,
  limit = 12
): OpenRouterModel[] {
  const clean = query.trim();
  if (!clean) return [];

  const scored: { model: OpenRouterModel; score: number }[] = [];

  for (const m of models) {
    const matchId = fuzzyScore(m.id, clean);
    const matchName = m.name ? fuzzyScore(m.name, clean) : null;
    const matchDesc = m.description ? fuzzyScore(m.description, clean) : null;

    let bestScore = -Infinity;
    if (matchId) bestScore = Math.max(bestScore, matchId.score + 50);
    if (matchName) bestScore = Math.max(bestScore, matchName.score + 20);
    if (matchDesc) bestScore = Math.max(bestScore, matchDesc.score);

    if (bestScore > -Infinity) {
      scored.push({ model: m, score: bestScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.model);
}
