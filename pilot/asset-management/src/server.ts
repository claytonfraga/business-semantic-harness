import { createAssetUseCases } from './assets/application/asset-use-cases.js';
import { assetOperations } from './assets/domain/asset.js';
import { createAssetHttpServer } from './assets/infrastructure/asset-http-server.js';
import { createAssetStore, InMemoryAssetRepository } from './assets/infrastructure/in-memory-asset-repository.js';

export type { Asset, AssetStatus } from './assets/domain/asset.js';
export { createAssetStore } from './assets/infrastructure/in-memory-asset-repository.js';

export function createAssetServer(store = createAssetStore()) {
  const repository = new InMemoryAssetRepository(store);
  const useCases = createAssetUseCases(repository, assetOperations);
  return createAssetHttpServer(useCases);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 3000);
  createAssetServer().listen(port, () => process.stdout.write(`Pilot em http://localhost:${port}\n`));
}
