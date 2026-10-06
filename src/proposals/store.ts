import { createHash, randomUUID } from 'node:crypto';
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

export type PatchProposalStatus = 'UNDER_REVIEW' | 'AUTHORIZED' | 'APPLIED' | 'REJECTED';

export interface PatchProposalFile {
  path: string;
  beforeSha256: string | null;
  content: string;
}

export interface PatchProposalInput {
  domain: string;
  summary: string;
  factsTurtle?: string;
  files: PatchProposalFile[];
}

export interface PatchProposal extends PatchProposalInput {
  id: string;
  status: PatchProposalStatus;
  digest: string;
  createdAt: string;
  updatedAt?: string;
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
  const directory = join(root, '.bsh', 'local', 'proposals');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertProjectDirectory(root, directory);
  await writeFile(join(directory, `${proposal.id}.json`), `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return proposal;
}

export async function createPatchProposal(root: string, input: PatchProposalInput): Promise<PatchProposal> {
  if (!input.files || input.files.length === 0) {
    throw new Error('Proposta sem arquivos: pelo menos um arquivo deve ser fornecido');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify({ domain: input.domain, summary: input.summary, factsTurtle: input.factsTurtle, files: input.files }))
    .digest('hex');

  const proposal: PatchProposal = {
    id: randomUUID(),
    domain: input.domain,
    summary: input.summary,
    factsTurtle: input.factsTurtle,
    files: input.files,
    status: 'UNDER_REVIEW',
    digest,
    createdAt: new Date().toISOString(),
  };

  const directory = join(root, '.bsh', 'local', 'proposals');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertProjectDirectory(root, directory);
  await writeFile(join(directory, `${proposal.id}.json`), `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return proposal;
}

export async function getPatchProposal(root: string, id: string): Promise<PatchProposal | null> {
  const filePath = join(root, '.bsh', 'local', 'proposals', `${id}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as PatchProposal;
  } catch {
    return null;
  }
}

export async function updatePatchProposalStatus(
  root: string,
  id: string,
  status: PatchProposalStatus
): Promise<PatchProposal> {
  const existing = await getPatchProposal(root, id);
  if (!existing) {
    throw new Error(`Proposta não encontrada: ${id}`);
  }
  const updated: PatchProposal = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
  };
  const filePath = join(root, '.bsh', 'local', 'proposals', `${id}.json`);
  await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'w', mode: 0o600 });
  return updated;
}

