import { applyAssetOperation, type Asset, type AssetOperation } from '../domain/asset.js';
import type { AssetRepository } from './asset-repository.js';

export function createAssetUseCases(
  repository: AssetRepository,
  operations: Readonly<Record<string, AssetOperation>>,
) {
  return {
    list: () => repository.list(),
    findById: (id: string) => repository.findById(id),
    actions: Object.keys(operations),
    execute(action: string, asset: Asset, input: Record<string, unknown>) {
      const change = applyAssetOperation(asset, input, operations[action]);
      repository.save(change.asset);
      const saved = repository.findById(asset.id);
      return change.justification === undefined
        ? saved
        : { ...saved, justification: change.justification };
    },
  };
}

export type AssetUseCases = ReturnType<typeof createAssetUseCases>;
