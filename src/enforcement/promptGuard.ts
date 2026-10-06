/**
 * Pre-flight Prompt Semantic Guard
 * Evaluates captured user prompts against domain ontology concepts and SHACL shape rules
 * to detect violating operational intents prior to model execution.
 */

export interface PromptViolationResult {
  isViolating: boolean;
  mechanism: 'REGEX_INTENT_TRIAGE';
  limitations: string;
  isTestInstruction?: boolean;
  shape?: string;
  rule?: string;
  message?: string;
  operation?: string;
  businessRationale?: string;
  remediation?: string[];
  matchedKeywords?: string[];
}

export interface PromptRuleDefinition {
  id: string;
  domainId: string;
  check: (normalizedPrompt: string) => PromptViolationResult | null;
}

export const DOMAIN_PROMPT_RULES: Map<string, PromptRuleDefinition[]> = new Map();

export function registerDomainPromptRule(rule: PromptRuleDefinition): void {
  const list = DOMAIN_PROMPT_RULES.get(rule.domainId) || [];
  list.push(rule);
  DOMAIN_PROMPT_RULES.set(rule.domainId, list);
}

export function clearDomainPromptRules(domainId?: string): void {
  if (domainId) DOMAIN_PROMPT_RULES.delete(domainId);
  else DOMAIN_PROMPT_RULES.clear();
}

function isTestInstructionPrompt(normalized: string): boolean {
  return /\b(teste|testar|testando|test|tests|testing|assert|verifique\s+se\s+bloqueia|garanta\s+o\s+bloqueio|cenário\s+de\s+teste|caso\s+de\s+teste|escreva\s+um\s+teste|crie\s+um\s+teste)\b/i.test(normalized);
}

const COMMON_LIMITATION = 'Heurística prévia baseada em expressões regulares; analisa apenas intenção no texto do prompt e não constitui consulta ontológica ou execução formal de shapes SHACL.';

// Register default asset-management package rules
function initDefaultAssetRules() {
  const assetDomains = ['ativos', 'patrimonio'];
  for (const d of assetDomains) {
    registerDomainPromptRule({
      id: `${d}-transfer-retired`,
      domainId: d,
      check: (normalized) => {
        // Explicit negation of the transfer command: e.g. "não transfira", "never transfer"
        const hasNegatedAction = /\b(não|nao|never|nunca|evite|don't|do\s+not|sem)\s+(transfira|transferir|movimentar|mover)\b/i.test(normalized);
        if (hasNegatedAction) return null;

        // Check for explicit negations of retired state on the transferred asset:
        // e.g. "não baixado", "nao baixado", "sem ser baixado", "não está baixado", "not retired"
        const hasNegatedRetired = /\b(não|nao|not|sem\s+ser|sem\s+estar|nunca)\s+(está\s+|esteja\s+)?(baixado|inativo|retired|decommissioned)\b/i.test(normalized);

        const mentionsRetired = !hasNegatedRetired && (
          /\b(retired|baixado|decommissioned|inativo)\b/i.test(normalized) ||
          /\b(ativo\s+já\s+baixado|estado\s+baixado|status\s+retired)\b/i.test(normalized)
        );
        const mentionsTransfer = /\b(transferir|transferência|transferencia|transfer|transfira|movimentar|movimentação|movimentacao|mover)\b/i.test(normalized);
        const mentionsNoJustification = /\b(without\s+justification|sem\s+justificativa|no\s+justification|sem\s+aprovação|sem\s+aprovacao|sem\s+aprovador|sem\s+motivo)\b/i.test(normalized);

        if (mentionsTransfer && mentionsRetired) {
          const keywords = ['transfer', 'retired/baixado'];
          if (mentionsNoJustification) keywords.push('sem justificativa');
          return {
            isViolating: true,
            mechanism: 'REGEX_INTENT_TRIAGE',
            limitations: COMMON_LIMITATION,
            operation: 'Transferência de Custódia de Ativo Patrimonial',
            shape: 'TransferShape (ex:TransferenciaShape)',
            rule: 'Invariante de Ciclo de Vida: Ativo baixado não pode ser transferido.',
            message: 'O prompt solicita a transferência de um ativo em estado Baixado/Retired, violando a regra de integridade do domínio.',
            businessRationale: 'A baixa encerra o registro contábil e a responsabilidade patrimonial da organização. Um ativo desincorporado não pode sofrer movimentação física nem troca de custódia.',
            remediation: [
              'Se o ativo voltou a operar, solicite a reativação patrimonial formal junto ao setor de controle.',
              'Para transferências válidas, informe o identificador de um ativo ativo ou em uso.',
            ],
            matchedKeywords: keywords,
          };
        }
        return null;
      },
    });

    registerDomainPromptRule({
      id: `${d}-double-baixa`,
      domainId: d,
      check: (normalized) => {
        const hasNegatedAction = /\b(não|nao|never|nunca|evite|don't|do\s+not)\s+(dar\s+baixa|baixar|efetuar\s+baixa|fazer\s+baixa|retire)\b/i.test(normalized);
        if (hasNegatedAction) return null;

        const hasNegatedRetired = /\b(não|nao|not|sem\s+ser|sem\s+estar|nunca)\s+(está\s+|esteja\s+)?(baixado|inativo|retired|decommissioned)\b/i.test(normalized);
        const mentionsRetired = !hasNegatedRetired && (
          /\b(retired|baixado|decommissioned|inativo)\b/i.test(normalized) ||
          /\b(ativo\s+já\s+baixado|estado\s+baixado|status\s+retired)\b/i.test(normalized)
        );
        const mentionsBaixaAction = /\b(retire\s+asset|dar\s+baixa|baixar\s+ativo|efetuar\s+baixa|fazer\s+baixa)\b/i.test(normalized);

        if (mentionsBaixaAction && mentionsRetired) {
          return {
            isViolating: true,
            mechanism: 'REGEX_INTENT_TRIAGE',
            limitations: COMMON_LIMITATION,
            operation: 'Baixa Patrimonial de Ativo',
            shape: 'BaixaShape (ex:BaixaShape)',
            rule: 'Invariante de Estado: Ativo baixado não pode sofrer nova baixa.',
            message: 'O prompt solicita nova baixa para um ativo já baixado.',
            businessRationale: 'O bem já se encontra formalmente desincorporado no inventário contábil. A duplicação da baixa geraria inconsistência de auditoria e distorção patrimonial.',
            remediation: [
              'Verifique o código ou plaqueta do ativo no inventário.',
              'Consulte o histórico de baixa no sistema patrimonial para obter o termo anterior.',
            ],
            matchedKeywords: ['baixa', 'ativo baixado'],
          };
        }
        return null;
      },
    });

    registerDomainPromptRule({
      id: `${d}-missing-justification`,
      domainId: d,
      check: (normalized) => {
        const mentionsTransfer = /\b(transferir|transferência|transferencia|transfer|transfira|movimentar|movimentação|movimentacao|mover)\b/i.test(normalized);
        const mentionsBaixaAction = /\b(retire\s+asset|dar\s+baixa|baixar\s+ativo|efetuar\s+baixa|fazer\s+baixa)\b/i.test(normalized);
        const mentionsNoJustification = /\b(without\s+justification|sem\s+justificativa|no\s+justification|sem\s+aprovação|sem\s+aprovacao|sem\s+aprovador|sem\s+motivo)\b/i.test(normalized);

        if (mentionsNoJustification && (mentionsTransfer || mentionsBaixaAction)) {
          return {
            isViolating: true,
            mechanism: 'REGEX_INTENT_TRIAGE',
            limitations: COMMON_LIMITATION,
            operation: 'Movimentação / Baixa Sensível de Patrimônio',
            shape: 'TransferShape / BaixaShape',
            rule: 'Obrigatoriedade de Justificativa e Aprovador Distinto.',
            message: 'Operações de movimentação ou baixa exigem justificativa e aprovador distinto do solicitante.',
            businessRationale: 'A governança patrimonial exige trilha de auditoria com justificativa fundamentada e aprovação segregada do solicitante para evitar desvios ou fraudes.',
            remediation: [
              'Especifique no prompt a justificativa de negócio da operação.',
              'Indique um aprovador formal distinto do solicitante da transferência.',
            ],
            matchedKeywords: ['sem justificativa'],
          };
        }
        return null;
      },
    });
  }
}

initDefaultAssetRules();

export function detectPromptViolation(
  prompt: string,
  domainId?: string
): PromptViolationResult {
  if (!domainId || !prompt) {
    return {
      isViolating: false,
      mechanism: 'REGEX_INTENT_TRIAGE',
      limitations: COMMON_LIMITATION,
    };
  }

  const normalized = prompt.toLowerCase();

  // If prompt is an instruction to test or assert the blocking of a violation,
  // it is not an attempt to violate the domain rule.
  if (isTestInstructionPrompt(normalized)) {
    return {
      isViolating: false,
      isTestInstruction: true,
      mechanism: 'REGEX_INTENT_TRIAGE',
      limitations: `Solicitação classificada como implementação ou teste de verificação da regra proibitiva; não constitui violação direta. ${COMMON_LIMITATION}`,
    };
  }

  const rules = DOMAIN_PROMPT_RULES.get(domainId) || (domainId.includes('asset') ? DOMAIN_PROMPT_RULES.get('ativos') : undefined) || [];

  for (const rule of rules) {
    const res = rule.check(normalized);
    if (res?.isViolating) {
      return res;
    }
  }

  return {
    isViolating: false,
    mechanism: 'REGEX_INTENT_TRIAGE',
    limitations: COMMON_LIMITATION,
  };
}


