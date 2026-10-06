export type RequestPurpose = 'EXECUTION' | 'EXPLANATION' | 'INSPECTION' | 'TESTING';

const informative = /^(?:explain|explique|describe|descreva|document|documente|clarify|esclareca|what|why|o que|por que|porque|qual|quais|quanto|how|como)\b/iu;
const inspection = /^(?:inspect|read|show|list|review|examine|verify|inspecione|leia|mostre|liste|revise|examine|verifique|ver|exiba)\b/iu;
const action = '(?:implement|implemente|create|crie|write|escreva|add|adicione|execute|executar|run|rode|deploy|publish|publique|remove|remova|delete|disable|desative|bypass|change|altere|modify|modifique|update|atualize|make|do|faca|transfira|transfer)';
const directive = `(?:(?:please|por favor)\\s+)?(?:(?:do not|don't|never|nao|nunca)\\s+)?(?:${action}|explain|explique|inspect|inspecione|read|leia|show|mostre|describe|descreva|test|teste)\\b`;
const transition = new RegExp(`(?:,|\\b(?:and then|and|then|afterwards|also|but|however|yet|em seguida|depois|entao|e|tambem|mas|porem)\\b)\\s*(?=${directive})`, 'giu');
const testingObject = new RegExp(`^${action}\\s+(?:(?:the|os|as|some|unit|integration|regression|automated|novos|new|de regressao)\\s+)*(?:tests?|testing|testes?)\\b`, 'iu');

/** Heuristic instruction boundaries preserve paths, decimal points and explanatory complements. */
function clauses(prompt: string): string[] {
  const normalized = prompt.normalize('NFKD').replace(/\p{M}/gu, '');
  return normalized.split(/(?<![\p{L}\p{N}_/])\.(?![\p{L}\p{N}_/])|(?<=[\p{L}\p{N}])\.(?=\s|$)|[!?;\n]+/u)
    .flatMap(sentence => sentence.split(transition))
    .map(clause => clause.trim().replace(/^(?:[-*]|\d+[.)])\s*/, '').replace(/^(?:please|por favor)\s+/iu, ''))
    .filter(Boolean);
}

function classifyClause(clause: string): RequestPurpose {
  if (informative.test(clause)) return 'EXPLANATION';
  if (inspection.test(clause)) return 'INSPECTION';
  // Negating the execution action is different from negating its tests or guards.
  if (new RegExp(`^(?:do not|don't|never|nao|nunca)\\s+${action}\\b`, 'iu').test(clause)) return 'INSPECTION';
  if (testingObject.test(clause) || /^(?:test|teste|testar)\b/iu.test(clause)) return 'TESTING';
  return 'EXECUTION';
}

export function analyzeRequestInstructions(prompt: string): Array<{ text: string; purpose: RequestPurpose }> {
  return clauses(prompt).map(text => ({ text, purpose: classifyClause(text) }));
}

/** Every execution instruction dominates informative instructions; unknown intent is conservative. */
export function identifyRequestPurpose(prompt: string): RequestPurpose {
  const purposes = analyzeRequestInstructions(prompt).map(instruction => instruction.purpose);
  if (purposes.length === 0 || purposes.includes('EXECUTION')) return 'EXECUTION';
  if (purposes.includes('TESTING')) return 'TESTING';
  if (purposes.includes('INSPECTION')) return 'INSPECTION';
  return 'EXPLANATION';
}
