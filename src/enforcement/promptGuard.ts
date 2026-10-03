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
  operation?: string;
  businessRationale?: string;
  remediation?: string[];
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

    // Check 2: Double retirement / baixa on retired asset (BaixaShape)
    const mentionsBaixaAction =
      /\b(retire\s+asset|dar\s+baixa|baixar\s+ativo|efetuar\s+baixa|fazer\s+baixa)\b/i.test(normalized);

    if (mentionsBaixaAction && mentionsRetired) {
      return {
        isViolating: true,
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

    // Check 3: Missing mandatory justification on sensitive operations
    if (mentionsNoJustification && (mentionsTransfer || mentionsBaixaAction)) {
      return {
        isViolating: true,
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
  }

  return { isViolating: false };
}
