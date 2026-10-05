import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import type { FatoSemantico } from './operacaoSemantica.js';

export interface EvidenciaRequerida {
  tipo: 'estrutural' | 'comportamental';
  propriedade?: string;
  descricao?: string;
  obrigatoria?: boolean;
}

export type OperadorLogico = 'AND' | 'OR' | 'E' | 'OU';

export interface CondicaoItem {
  caminho?: string;
  removeu?: string;
  adicionou?: string;
  arquivoRemovido?: boolean;
  arquivoAdicionado?: boolean;
  arquivoRenomeado?: boolean;
  ignorarComentarios?: boolean;
  ignorarMensagens?: boolean;
}

export interface CondicaoQuando extends CondicaoItem {
  caminho: string;
  operador?: OperadorLogico;
  todas?: CondicaoItem[];
  qualquer?: CondicaoItem[];
}

export interface RegraGovernanca {
  id: string;
  dominio: string;
  operacao: string;
  quando: CondicaoQuando;
  fatos: FatoSemantico[];
  evidenciasRequeridas?: EvidenciaRequerida[];
  dependenciasDominio?: string[];
}

export interface ArquivoGovernanca {
  schemaVersion?: 1;
  regras?: Array<Omit<RegraGovernanca, 'dominio'>>;
}

export type GovernanceConfigErrorCode = 'NOT_FOUND' | 'INVALID' | 'READ_ERROR';

export class GovernanceConfigError extends Error {
  constructor(
    public readonly code: GovernanceConfigErrorCode,
    public readonly domainId: string,
    public readonly filePath: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GovernanceConfigError';
  }
}

export interface GovernanceConfigDiagnostic {
  domainId: string;
  path: string;
  status: 'VALID' | 'NOT_FOUND' | 'INVALID' | 'READ_ERROR';
  message: string;
  regrasCount?: number;
  error?: Error;
}

export async function diagnosticarConfiguracaoGovernanca(root: string): Promise<GovernanceConfigDiagnostic[]> {
  const manifest = await loadManifest(root);
  const diagnostics: GovernanceConfigDiagnostic[] = [];

  for (const dominio of manifest.domains) {
    const relativo = dominio.enforcement || `${dirname(dominio.ontology)}/enforcement.json`;
    const fullPath = `.bsh/${relativo}`;

    let resolvedPath: string;
    try {
      resolvedPath = await resolveProjectFile(root, fullPath);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        diagnostics.push({
          domainId: dominio.id,
          path: fullPath,
          status: 'NOT_FOUND',
          message: `Arquivo de governança inexistente: ${fullPath}`,
        });
        continue;
      }
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'READ_ERROR',
        message: `Falha ao resolver caminho do arquivo de governança: ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      continue;
    }

    let conteudo: string;
    try {
      conteudo = await readFile(resolvedPath, 'utf8');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        diagnostics.push({
          domainId: dominio.id,
          path: fullPath,
          status: 'NOT_FOUND',
          message: `Arquivo de governança inexistente: ${fullPath}`,
        });
        continue;
      }
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'READ_ERROR',
        message: `Erro de leitura no arquivo de governança (${fullPath}): ${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(conteudo);
    } catch (err: unknown) {
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'INVALID',
        message: `Arquivo de governança malformado (${fullPath}): JSON inválido`,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'INVALID',
        message: `Esquema de governança inválido (${fullPath}): objeto JSON esperado`,
      });
      continue;
    }

    const arquivo = parsed as ArquivoGovernanca;
    if (arquivo.regras !== undefined && !Array.isArray(arquivo.regras)) {
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'INVALID',
        message: `Campo 'regras' inválido em ${fullPath}: array esperado`,
      });
      continue;
    }

    const regras = arquivo.regras ?? [];
    let regraInvalida: string | undefined;
    for (const [idx, r] of regras.entries()) {
      if (!r || typeof r !== 'object' || !r.id || !r.operacao || !r.quando || typeof r.quando.caminho !== 'string') {
        regraInvalida = `Regra inválida no índice ${idx} em ${fullPath}`;
        break;
      }
    }

    if (regraInvalida) {
      diagnostics.push({
        domainId: dominio.id,
        path: fullPath,
        status: 'INVALID',
        message: regraInvalida,
      });
      continue;
    }

    diagnostics.push({
      domainId: dominio.id,
      path: fullPath,
      status: 'VALID',
      message: `Configuração de governança válida para o domínio ${dominio.id}`,
      regrasCount: regras.length,
    });
  }

  return diagnostics;
}

export async function carregarRegrasGovernanca(
  root: string,
  options: { allowMissing?: boolean } = {}
): Promise<RegraGovernanca[]> {
  const allowMissing = options.allowMissing ?? true;
  const manifest = await loadManifest(root);
  const regras: RegraGovernanca[] = [];

  for (const dominio of manifest.domains) {
    const relativo = dominio.enforcement || `${dirname(dominio.ontology)}/enforcement.json`;
    const fullPath = `.bsh/${relativo}`;

    let resolvedPath: string;
    try {
      resolvedPath = await resolveProjectFile(root, fullPath);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        if (!allowMissing) {
          throw new GovernanceConfigError('NOT_FOUND', dominio.id, fullPath, `Arquivo de governança não encontrado: ${fullPath}`, err);
        }
        continue;
      }
      throw new GovernanceConfigError(
        'READ_ERROR',
        dominio.id,
        fullPath,
        `Erro ao resolver arquivo de governança (${fullPath}): ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    let conteudo: string;
    try {
      conteudo = await readFile(resolvedPath, 'utf8');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'ENOENT') {
        if (!allowMissing) {
          throw new GovernanceConfigError('NOT_FOUND', dominio.id, fullPath, `Arquivo de governança não encontrado: ${fullPath}`, err);
        }
        continue;
      }
      throw new GovernanceConfigError(
        'READ_ERROR',
        dominio.id,
        fullPath,
        `Erro de leitura no arquivo de governança (${fullPath}): ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(conteudo);
    } catch (err: unknown) {
      throw new GovernanceConfigError(
        'INVALID',
        dominio.id,
        fullPath,
        `Arquivo de governança malformado (${fullPath}): ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new GovernanceConfigError(
        'INVALID',
        dominio.id,
        fullPath,
        `Esquema de governança inválido (${fullPath}): objeto JSON esperado`
      );
    }

    const arquivo = parsed as ArquivoGovernanca;
    if (arquivo.regras !== undefined && !Array.isArray(arquivo.regras)) {
      throw new GovernanceConfigError(
        'INVALID',
        dominio.id,
        fullPath,
        `Campo 'regras' inválido em ${fullPath}: array esperado`
      );
    }

    for (const [idx, r] of (arquivo.regras ?? []).entries()) {
      if (!r || typeof r !== 'object' || !r.id || !r.operacao || !r.quando || typeof r.quando.caminho !== 'string') {
        throw new GovernanceConfigError(
          'INVALID',
          dominio.id,
          fullPath,
          `Regra inválida no índice ${idx} em ${fullPath}: campos id, operacao e quando.caminho são obrigatórios`
        );
      }
      regras.push({ ...r, dominio: dominio.id });
    }
  }

  return regras;
}
