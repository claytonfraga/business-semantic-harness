export type AssetStatus = 'Disponivel' | 'EmUso' | 'Baixado';
export interface Asset {
  id: string;
  name: string;
  status: AssetStatus;
  location: string;
  responsible: string;
  retirementReason?: string;
}

export class RetiredAssetError extends Error {
  constructor() {
    super('Ativo baixado não pode ser alterado');
  }
}

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Campo obrigatório ausente');
  return value.trim();
}

export interface AssetChange {
  asset: Asset;
  justification?: string;
}

export type AssetOperation = (asset: Asset, input: Record<string, unknown>) => AssetChange;

export function applyAssetOperation(
  asset: Asset,
  input: Record<string, unknown>,
  operation: AssetOperation,
): AssetChange {
  if (asset.status === 'Baixado') throw new RetiredAssetError();
  return operation(asset, input);
}

export const assetOperations = {
  transfer(asset, input) {
    const responsible = required(input.responsible);
    const justification = required(input.justification);
    const location = required(input.location);
    return { asset: { ...asset, responsible, location, status: 'EmUso' }, justification };
  },
  retire(asset, input) {
    const retirementReason = required(input.reason);
    return { asset: { ...asset, status: 'Baixado', retirementReason } };
  },
  responsible(asset, input) {
    return { asset: { ...asset, responsible: required(input.responsible) } };
  },
  location(asset, input) {
    return { asset: { ...asset, location: required(input.location) } };
  },
} satisfies Record<string, AssetOperation>;
