export type AssetStatus =
  | 'Disponivel'
  | 'EmUso'
  | 'Baixado'
  | 'EmManutencao'
  | 'EmTransito'
  | 'Reservado'
  | 'Extraviado';

export interface Asset {
  id: string;
  name: string;
  status: AssetStatus;
  location: string;
  responsible: string;
  retirementReason?: string;
  assetType?: string;
  code?: string;
  serialNumber?: string;
  acquisitionValue?: number;
  residualValue?: number;
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
  allocate(asset, input) {
    if (asset.status === 'EmManutencao' || asset.status === 'Extraviado') {
      throw new Error('Ativo em manutenção ou extraviado não pode ser alocado');
    }
    const responsible = required(input.responsible);
    return { asset: { ...asset, responsible, status: 'EmUso' } };
  },
  reserve(asset, input) {
    if (asset.status !== 'Disponivel') throw new Error('Apenas ativo disponível pode ser reservado');
    const responsible = required(input.responsible);
    return { asset: { ...asset, responsible, status: 'Reservado' } };
  },
  maintenance(asset, _input) {
    return { asset: { ...asset, status: 'EmManutencao' } };
  },
  reportLoss(asset, input) {
    const protocol = required(input.protocol);
    return { asset: { ...asset, status: 'Extraviado' }, justification: protocol };
  },
  recover(asset, _input) {
    if (asset.status !== 'Extraviado') throw new Error('Apenas ativo extraviado pode ser recuperado');
    return { asset: { ...asset, status: 'Disponivel' } };
  },
} satisfies Record<string, AssetOperation>;
