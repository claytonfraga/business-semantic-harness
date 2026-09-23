import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export type AssetStatus = 'Disponivel' | 'EmUso' | 'Baixado';
export interface Asset {
  id: string;
  name: string;
  status: AssetStatus;
  location: string;
  responsible: string;
}

const seed: Asset[] = [
  { id: 'A-100', name: 'Notebook', status: 'EmUso', location: 'São Paulo', responsible: 'Ana' },
  { id: 'A-200', name: 'Projetor', status: 'Disponivel', location: 'Campinas', responsible: 'Bruno' },
  { id: 'A-300', name: 'Impressora', status: 'Baixado', location: 'Arquivo', responsible: 'Carla' },
];

export function createAssetStore(initial: Asset[] = seed): Map<string, Asset> {
  return new Map(initial.map((asset) => [asset.id, { ...asset }]));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).length > 32_768) throw new Error('Corpo muito grande');
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Objeto JSON esperado');
  return parsed as Record<string, unknown>;
}

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Campo obrigatório ausente');
  return value.trim();
}

export function createAssetServer(store = createAssetStore()) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Gestão de ativos</title><h1>Gestão de ativos</h1><p>API: GET /assets; POST /assets/{id}/transfer, /retire, /responsible, /location.</p></html>');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/assets') {
      json(response, 200, [...store.values()]);
      return;
    }
    const match = /^\/assets\/([^/]+)\/(transfer|retire|responsible|location)$/.exec(url.pathname);
    if (request.method !== 'POST' || !match) { json(response, 404, { error: 'Rota não encontrada' }); return; }
    const asset = store.get(decodeURIComponent(match[1]));
    if (!asset) { json(response, 404, { error: 'Ativo não encontrado' }); return; }
    try {
      const input = await body(request);
      if (match[2] === 'transfer') {
        if (asset.status === 'Baixado') { json(response, 409, { error: 'Ativo baixado não pode ser transferido' }); return; }
        const responsible = required(input.responsible);
        const justification = required(input.justification);
        const location = required(input.location);
        store.set(asset.id, { ...asset, responsible, location, status: 'EmUso' });
        json(response, 200, { ...store.get(asset.id), justification });
        return;
      }
      if (match[2] === 'retire') {
        store.set(asset.id, { ...asset, status: 'Baixado' });
      } else if (match[2] === 'responsible') {
        store.set(asset.id, { ...asset, responsible: required(input.responsible) });
      } else {
        store.set(asset.id, { ...asset, location: required(input.location) });
      }
      json(response, 200, store.get(asset.id));
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 3000);
  createAssetServer().listen(port, () => process.stdout.write(`Pilot em http://localhost:${port}\n`));
}
