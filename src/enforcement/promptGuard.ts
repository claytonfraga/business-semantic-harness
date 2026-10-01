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

  if (domainId === 'ativos' || domainId.includes('asset')) {
    // Check 1: Transfer of retired / baixado assets (TransferShape)
    const mentionsTransfer =
      normalized.includes('transfer') ||
      normalized.includes('transferir') ||
      normalized.includes('transferência') ||
      normalized.includes('movimentar') ||
      normalized.includes('mover');

    const mentionsRetired =
      normalized.includes('retired') ||
      normalized.includes('baixado') ||
      normalized.includes('baixa') ||
      normalized.includes('decommissioned') ||
      normalized.includes('inativo');

    const mentionsNoJustification =
      normalized.includes('without justification') ||
      normalized.includes('sem justificativa') ||
      normalized.includes('no justification') ||
      normalized.includes('sem aprovação') ||
      normalized.includes('sem aprovador') ||
      normalized.includes('sem motivo');

    if (mentionsTransfer && mentionsRetired) {
      const keywords = ['transfer', mentionsRetired ? 'retired/baixado' : ''].filter(Boolean);
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
      normalized.includes('retire asset') ||
      normalized.includes('dar baixa') ||
      normalized.includes('baixar ativo') ||
      normalized.includes('efetuar baixa');

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
