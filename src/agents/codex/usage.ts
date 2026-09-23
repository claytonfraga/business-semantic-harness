export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseTokenTotals(value: unknown): TokenTotals | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const total = (value as Record<string, unknown>).total;
  if (!total || typeof total !== 'object') return undefined;
  const source = total as Record<string, unknown>;
  return {
    inputTokens: readNumber(source, 'inputTokens'),
    outputTokens: readNumber(source, 'outputTokens'),
    cachedInputTokens: readNumber(source, 'cachedInputTokens'),
    reasoningOutputTokens: readNumber(source, 'reasoningOutputTokens'),
    totalTokens: readNumber(source, 'totalTokens'),
  };
}

export function parseLastTotalTokens(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const last = (value as Record<string, unknown>).last;
  if (!last || typeof last !== 'object') return 0;
  return readNumber(last as Record<string, unknown>, 'totalTokens');
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function formatUsageReport(
  totals: TokenTotals | undefined,
  ontologyQueries: number,
  conflicts: number,
  harnessTokens: number,
): string {
  if (!totals) {
    return `Oracle: tokens indisponiveis nesta sessao; consultas a ontologia: ${ontologyQueries}; conflitos: ${conflicts}.`;
  }
  return [
    'Oracle: custo da verificacao ontologica nesta sessao',
    `  tokens de entrada: ${totals.inputTokens} (cache: ${totals.cachedInputTokens})`,
    `  tokens de saida: ${totals.outputTokens} (raciocinio: ${totals.reasoningOutputTokens})`,
    `  tokens totais: ${totals.totalTokens}`,
    `  tokens gastos a mais pelo harness (verificacao ontologica): ${harnessTokens} (${percent(harnessTokens, totals.totalTokens)} do total)`,
    `  consultas a ontologia: ${ontologyQueries}; conflitos relatados: ${conflicts}`,
  ].join('\n');
}

export interface SavingsReport {
  baselineTokens: number;
  oracleTokens: number;
  savedTokens: number;
  savedPercent: string;
}

export function savingsReport(baselineTokens: number, oracleTokens: number): SavingsReport {
  const savedTokens = baselineTokens - oracleTokens;
  return {
    baselineTokens,
    oracleTokens,
    savedTokens,
    savedPercent: baselineTokens > 0 ? percent(savedTokens, baselineTokens) : '0%',
  };
}

export function formatSavingsReport(savings: SavingsReport): string {
  return `Oracle: economia com o harness — Codex direto: ${savings.baselineTokens} tokens; com Oracle: ${savings.oracleTokens} tokens; economia: ${savings.savedTokens} tokens (${savings.savedPercent}).`;
}