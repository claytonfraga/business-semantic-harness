import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AssetUseCases } from '../application/asset-use-cases.js';
import { RetiredAssetError } from '../domain/asset.js';

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

export function createAssetHttpServer(useCases: AssetUseCases) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Gestão de ativos</title><h1>Gestão de ativos</h1><p>API: GET /assets; POST /assets/{id}/transfer, /retire, /responsible, /location.</p></html>');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/assets') {
      json(response, 200, useCases.list());
      return;
    }
    const match = /^\/assets\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (request.method !== 'POST' || !match || !useCases.actions.includes(match[2])) { json(response, 404, { error: 'Rota não encontrada' }); return; }
    const asset = useCases.findById(decodeURIComponent(match[1]));
    if (!asset) { json(response, 404, { error: 'Ativo não encontrado' }); return; }
    try {
      const input = await body(request);
      json(response, 200, useCases.execute(match[2], asset, input));
    } catch (error) {
      json(response, error instanceof RetiredAssetError ? 409 : 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

