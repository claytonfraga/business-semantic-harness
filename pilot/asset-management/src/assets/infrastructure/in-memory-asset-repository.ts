import type { Asset } from '../domain/asset.js';
import type { AssetRepository } from '../application/asset-repository.js';

const seed: Asset[] = [
  { id: 'A-100', name: 'Notebook', status: 'EmUso', location: 'São Paulo', responsible: 'Ana' },
  { id: 'A-200', name: 'Projetor', status: 'Disponivel', location: 'Campinas', responsible: 'Bruno' },
  { id: 'A-300', name: 'Impressora', status: 'Baixado', location: 'Arquivo', responsible: 'Carla' },
];

export function createAssetStore(initial: Asset[] = seed): Map<string, Asset> {
  return new Map(initial.map((asset) => [asset.id, { ...asset }]));
}

export class InMemoryAssetRepository implements AssetRepository {
  constructor(private readonly store: Map<string, Asset>) {}

  list(): Asset[] {
    return [...this.store.values()];
  }

  findById(id: string): Asset | undefined {
    return this.store.get(id);
  }

  save(asset: Asset): void {
    this.store.set(asset.id, asset);
  }
}
