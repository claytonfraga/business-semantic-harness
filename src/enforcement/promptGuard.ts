/**
 * Pre-flight Prompt Semantic Guard
 * Evaluates captured user prompts against domain ontology concepts and SHACL shape rules
 * to detect violating operational intents prior to model execution.
 */

export interface PromptViolationResult {
  isViolating: boolean;
  shape?: string;
  rule?: string;
  message?: string;
  matchedKeywords?: string[];
}

export function detectPromptViolation(
  prompt: string,
  domainId?: string
): PromptViolationResult {
  if (!domainId || !prompt) {
    return { isViolating: false };
  }

  const normalized = prompt.toLowerCase();

  if (domainId === 'ativos' || domainId === 'patrimonio' || domainId.includes('asset')) {
    // 1. Check for explicit negations of retired state:
    // e.g. "não baixado", "nao baixado", "sem ser baixado", "não está baixado", "not retired"
    const hasNegatedRetired = /\b(não|nao|not|sem\s+ser|sem\s+estar|nunca)\s+(está\s+|esteja\s+)?(baixado|inativo|retired|decommissioned)\b/i.test(normalized);

    // 2. Mentions actual retired status (only if NOT negated)
    const mentionsRetired = !hasNegatedRetired && (
      /\b(retired|baixado|decommissioned|inativo)\b/i.test(normalized) ||
      /\b(ativo\s+já\s+baixado|estado\s+baixado|status\s+retired)\b/i.test(normalized)
    );

    // 3. Transfer action (must use word boundaries so 'remover' does NOT match 'mover'!)
    const mentionsTransfer = /\b(transferir|transferência|transferencia|transfer|transfira|movimentar|movimentação|movimentacao|mover)\b/i.test(normalized);

    // 4. Missing justification on sensitive operations
    const mentionsNoJustification =
      /\b(without\s+justification|sem\s+justificativa|no\s+justification|sem\s+aprovação|sem\s+aprovacao|sem\s+aprovador|sem\s+motivo)\b/i.test(normalized);

    // Check 1: Transfer of retired / baixado assets (TransferShape)
    if (mentionsTransfer && mentionsRetired) {
      const keywords = ['transfer', 'retired/baixado'];
      if (mentionsNoJustification) keywords.push('sem justificativa');

      return {
        isViolating: true,
        shape: 'TransferShape (ex:TransferenciaShape)',
        rule: 'Invariante de Ciclo de Vida: Ativo baixado não pode ser transferido.',
        message: 'O prompt solicita a transferência de um ativo em estado Baixado/Retired, violando a regra de integridade do domínio.',
        matchedKeywords: keywords,
      };
    }

    // Check 2: Double retirement / baixa on retired asset (BaixaShape)
    const mentionsBaixaAction =
      /\b(retire\s+asset|dar\s+baixa|baixar\s+ativo|efetuar\s+baixa|fazer\s+baixa)\b/i.test(normalized);

    if (mentionsBaixaAction && mentionsRetired) {
      return {
        isViolating: true,
        shape: 'BaixaShape (ex:BaixaShape)',
        rule: 'Invariante de Estado: Ativo baixado não pode sofrer nova baixa.',
        message: 'O prompt solicita nova baixa para um ativo já baixado.',
        matchedKeywords: ['baixa', 'ativo baixado'],
      };
    }

    // Check 3: Missing mandatory justification on sensitive operations
    if (mentionsNoJustification && (mentionsTransfer || mentionsBaixaAction)) {
      return {
        isViolating: true,
        shape: 'TransferShape / BaixaShape',
        rule: 'Obrigatoriedade de Justificativa e Aprovador.',
        message: 'Operações de movimentação ou baixa exigem justificativa e aprovador distinto do solicitante.',
        matchedKeywords: ['sem justificativa'],
      };
    }
  }

  return { isViolating: false };
}
