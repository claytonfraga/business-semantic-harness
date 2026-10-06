export type RequestPurpose = 'EXECUTION' | 'EXPLANATION' | 'INSPECTION' | 'TESTING';

const informative = /^(?:explain|explique|describe|descreva|document|documente|clarify|esclareca|what|why|o que|por que|porque|qual|quais|quanto|how|como)\b/iu;
const inspection = /^(?:inspect|read|show|list|review|examine|verify|inspecione|leia|mostre|liste|revise|examine|verifique|ver|exiba)\b/iu;
const action = '(?:implement|implemente|create|crie|write|escreva|add|adicione|execute|executar|run|rode|deploy|publish|publique|remove|remova|delete|disable|desative|bypass|change|altere|modify|modifique|update|atualize|make|do|faca|transfira|transfer|develop|desenvolva|desenvolver|build|construct|construa|construir|refactor|refatore|refatorar)';
const transition = /(?:,|\b(?:and then|and|then|afterwards|also|but|however|yet|em seguida|depois|entao|e|tambem|mas|porem)\b)\s+/giu;
// Only recognizable nominal/explanatory continuations inherit the prior purpose.
// Every other connective fragment is independently classified, including unknown verbs.
const continuation = /^(?:its|their|the|a|an|including|such as|for example|with|without|in|of|constraints|restrictions|suas|seus|sua|seu|os|as|o|a|incluindo|inclusive|como|com|sem|em|de|restricoes)\b/iu;
const testingObject = new RegExp(`^${action}\\s+(?:(?:the|os|as|some|unit|integration|regression|automated|novos|new|de regressao)\\s+)*(?:tests?|testing|testes?)\\b`, 'iu');

/** Heuristic instruction boundaries preserve paths, decimal points and explanatory complements. */
function clauses(prompt: string): string[] {
  const normalized = prompt.normalize('NFKD').replace(/\p{M}/gu, '');
  return normalized.split(/(?<![\p{L}\p{N}_/])\.(?![\p{L}\p{N}_/])|(?<=[\p{L}\p{N}])\.(?=\s|$)|[!?;\n]+/u)
    .flatMap(sentence => {
      const result: string[] = [];
      for (const raw of sentence.split(transition)) {
        const fragment = raw.trim().replace(/^(?:[-*]|\d+[.)])\s*/, '').replace(/^(?:please|por favor)\s+/iu, '');
        if (!fragment) continue;
        const nominal = continuation.test(fragment) || (/^[A-Z][\p{L}\p{N}_:/.-]*$/u.test(fragment) && !new RegExp(`^${action}\\b`, 'iu').test(fragment));
        if (result.length > 0 && nominal) result[result.length - 1] += `, ${fragment}`;
        else result.push(fragment);
      }
      return result;
    });
}

function classifyClause(clause: string): RequestPurpose {
  if (informative.test(clause)) return 'EXPLANATION';
  if (inspection.test(clause)) return 'INSPECTION';
  // Negating the execution action is different from negating its tests or guards.
  if (new RegExp(`^(?:do not|don't|never|nao|nunca)\\s+${action}\\b`, 'iu').test(clause)) return 'INSPECTION';
  if (testingObject.test(clause) || /^(?:test|teste|testar)\b/iu.test(clause)) return 'TESTING';
  return 'EXECUTION';
}

export function analyzeRequestInstructions(prompt: string): Array<{ text: string; purpose: RequestPurpose; uncertain: boolean }> {
  return clauses(prompt).map(text => {
    const purpose = classifyClause(text);
    return { text, purpose, uncertain: purpose === 'EXECUTION' && !new RegExp(`^${action}\\b`, 'iu').test(text) };
  });
}

/** Every execution instruction dominates informative instructions; unknown intent is conservative. */
export function identifyRequestPurpose(prompt: string): RequestPurpose {
  const purposes = analyzeRequestInstructions(prompt).map(instruction => instruction.purpose);
  if (purposes.length === 0 || purposes.includes('EXECUTION')) return 'EXECUTION';
  if (purposes.includes('TESTING')) return 'TESTING';
  if (purposes.includes('INSPECTION')) return 'INSPECTION';
  return 'EXPLANATION';
}
