#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { queryOntology } from '../ontology/query.js';
import { validateProject } from '../ontology/validate.js';
import { createProposal, createPatchProposal } from '../proposals/store.js';
import { detectPromptViolation } from '../enforcement/promptGuard.js';
import { getAvailableDomains, loadDomainValidator } from '../governance/domainRegistry.js';
import { checkDomainAffinity } from '../governance/domainAffinity.js';
import { parseShapes } from '../ontology/rdf.js';

function recordSessionEvent(fileName: string, entry: Record<string, unknown>): void {
  const directory = process.env.BSH_SESSION_DIR;
  if (!directory) return;
  const line = `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`;
  appendFile(join(directory, fileName), line, { mode: 0o600 }).catch(() => undefined);
}

export function createBSHMcpServer(root: string, governed = false): McpServer {
  const server = new McpServer(
    { name: 'bsh', version: '0.2.7-beta' },
    { instructions: 'Consulte a ontologia do domínio e valide propostas com regras SHACL antes de alterar o código do projeto.' },
  );

  server.registerTool('bsh_query_ontology', {
    description: 'Consulta conceitos, relações, shapes e regras de um domínio com origem verificável.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { domain: z.string(), iri: z.string().optional() },
  }, async ({ domain, iri }) => {
    try {
      const result = await queryOntology(root, domain, iri);
      recordSessionEvent('ontology-queries.jsonl', { domain, iri: iri ?? null });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.registerTool('bsh_check_prompt_intent', {
    description: 'Executa triagem heurística de intenção do prompt via expressões regulares. Não substitui consulta ontológica ou validação SHACL.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { prompt: z.string(), domain: z.string().optional() },
  }, async ({ prompt, domain }) => {
    try {
      const result = detectPromptViolation(prompt, domain ?? 'ativos');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.registerTool('bsh_validate_shacl', {
    description: 'Valida consultivamente fatos RDF/Turtle autodeclarados contra shapes SHACL. Não comprova correspondência com o código do projeto nem autoriza promoção.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { domain: z.string(), factsTurtle: z.string() },
  }, async ({ domain, factsTurtle }) => {
    try {
      const validator = await loadDomainValidator(root, domain);
      const dataStore = parseShapes(factsTurtle);
      const report = await validator.validateChanges(dataStore);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...report,
            role: 'CONSULTATIVE',
            isSelfDeclaredPayload: true,
            authorizesPromotion: false,
            limitations: 'Validação consultiva de fatos autodeclarados pelo cliente. Não atesta correspondência com arquivos do projeto nem substitui a extração de evidências do host para promoção.',
          }),
        }],
      };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.registerTool('bsh_check_affinity', {
    description: 'Calcula a afinidade semântica entre os conceitos da ontologia do domínio e os identificadores do código do projeto.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { domain: z.string() },
  }, async ({ domain }) => {
    try {
      const domains = await getAvailableDomains(root);
      const target = domains.find((d) => d.id === domain);
      if (!target) throw new Error(`Domínio '${domain}' não encontrado no projeto.`);
      const aff = await checkDomainAffinity(root, target.ontologyPath, target.shapesPath, domain);
      return { content: [{ type: 'text', text: JSON.stringify(aff) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  if (governed) {
    server.registerTool('bsh_report_conflict', {
      description: 'Quando o pedido conflita com a ontologia, relate as regras e aguarde o BSH perguntar ao usuário se deve preparar uma proposta de exceção. Não aplica nem autoriza mudança.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: { domain: z.string(), request: z.string(), conflictingRules: z.array(z.string()).min(1), reason: z.string() },
    }, async ({ domain, request, conflictingRules, reason }) => {
      const digest = createHash('sha256').update(JSON.stringify({ domain, request, conflictingRules, reason })).digest('hex');
      recordSessionEvent('alerts.jsonl', { severity: 'ALERTA', domain, request, conflictingRules, reason, digest });
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'submitted', digest, message: 'Conflito enviado ao BSH para pergunta humana.' }) }] };
    });
    server.registerTool('bsh_propose_patch', {
      description: 'Propõe alterações de arquivos ao BSH e persiste a proposta em .bsh/local/proposals/. Esta ferramenta não escreve no projeto. Cada arquivo informa seu hash anterior ou null para criação.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        domain: z.string(), summary: z.string(), factsTurtle: z.string().optional(),
        files: z.array(z.object({ path: z.string(), beforeSha256: z.string().nullable(), content: z.string() })).min(1),
      },
    }, async ({ domain, summary, factsTurtle, files }) => {
      try {
        const proposal = await createPatchProposal(root, { domain, summary, factsTurtle, files });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'submitted',
              proposalId: proposal.id,
              digest: proposal.digest,
              proposalStatus: proposal.status,
              message: 'Proposta persistida e enviada ao BSH. Aguarde a revisão fora deste turno.',
            }),
          }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    });
    return server;
  }
  server.registerTool('bsh_propose_observation', {
    description: 'Registra uma proposta pendente com evidência em arquivo do projeto; não altera ontologias aprovadas.',
    inputSchema: {
      domain: z.string(), iri: z.string(), candidate: z.record(z.string(), z.unknown()),
      evidenceFile: z.string(), evidenceExcerpt: z.string(),
    },
  }, async ({ domain, iri, candidate, evidenceFile, evidenceExcerpt }) => {
    try {
      const proposal = await createProposal(root, { domain, iri, candidate, evidence: { file: evidenceFile, excerpt: evidenceExcerpt } });
      return { content: [{ type: 'text', text: JSON.stringify({ id: proposal.id, status: proposal.status, ontologyDigest: proposal.ontologyDigest }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  return server;
}

export async function main(root: string, governed = false): Promise<void> {
  const report = await validateProject(root);
  if (!report.ready) throw new Error(`Ontologia não pronta: ${report.issues.map((issue) => issue.message).join('; ')}`);
  await createBSHMcpServer(root, governed).connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main(process.argv[2] ?? process.cwd(), process.argv[3] === 'governed').catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
