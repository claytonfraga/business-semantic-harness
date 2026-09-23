import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertProjectDirectory, resolveProjectFile } from '../project/paths.js';
import { loadManifest } from '../project/manifest.js';
import { createOntologySnapshot } from '../ontology/query.js';

export interface ProposalInput {
  domain: string;
  iri: string;
  candidate: Record<string, unknown>;
  evidence: { file: string; excerpt: string };
}

export interface Proposal extends ProposalInput {
  id: string;
  status: 'pending';
  ontologyDigest: string;
  createdAt: string;
}

export async function createProposal(root: string, input: ProposalInput): Promise<Proposal> {
  const manifest = await loadManifest(root);
  if (!manifest.domains.some((domain) => domain.id === input.domain)) throw new Error(`Domínio não declarado: ${input.domain}`);
  if (!input.iri || !input.candidate || !input.evidence.excerpt.trim()) throw new Error('Proposta sem IRI, conteúdo ou evidência');
  const evidencePath = await resolveProjectFile(root, input.evidence.file);
  const source = await readFile(evidencePath, 'utf8');
  if (!source.includes(input.evidence.excerpt)) throw new Error('Evidência não encontrada no arquivo citado');
  const snapshot = await createOntologySnapshot(root);
  const proposal: Proposal = {
    ...input,
    id: randomUUID(), status: 'pending', ontologyDigest: snapshot.digest, createdAt: new Date().toISOString(),
  };
  const directory = join(root, '.oracle', 'local', 'proposals');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertProjectDirectory(root, directory);
  await writeFile(join(directory, `${proposal.id}.json`), JSON.stringify(proposal, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return proposal;
}
