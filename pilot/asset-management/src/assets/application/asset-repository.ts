import type { Asset } from '../domain/asset.js';

export interface AssetRepository {
  list(): Asset[];
  findById(id: string): Asset | undefined;
  save(asset: Asset): void;
}
