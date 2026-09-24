import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import type { FatoSemantico } from './operacaoSemantica.js';

export interface RegraGovernanca {
  id: string;
  dominio: string;
  operacao: string;
  quando: { caminho: string; removeu?: string; adicionou?: string; arquivoRemovido?: boolean };
  fatos: FatoSemantico[];
}

interface ArquivoGovernanca {
  regras?: Array<Omit<RegraGovernanca, 'dominio'>>;
}

export async function carregarRegrasGovernanca(root: string): Promise<RegraGovernanca[]> {
  const manifest = await loadManifest(root);
  const regras: RegraGovernanca[] = [];
  for (const dominio of manifest.domains) {
    const relativo = `${dirname(dominio.ontology)}/enforcement.json`;
    let conteudo: string;
    try {
      conteudo = await readFile(await resolveProjectFile(root, `.bsh/${relativo}`), 'utf8');
    } catch {
      continue;
    }
    const arquivo = JSON.parse(conteudo) as ArquivoGovernanca;
    for (const regra of arquivo.regras ?? []) {
      regras.push({ ...regra, dominio: dominio.id });
    }
  }
  return regras;
}
