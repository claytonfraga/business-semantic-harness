import { randomUUID } from 'node:crypto';
import { actionDigest, type ActionEvaluation, type ProposedAction } from './evaluate.js';
import { appendAudit, type AuditEvent } from './audit.js';
import { assertOntologySnapshot, type OntologySnapshot } from '../ontology/query.js';

export interface ApprovalQuestion {
  action: ProposedAction;
  evaluation: ActionEvaluation;
  choices: ['allow-once', 'deny'];
}

export interface HumanAnswer {
  choice: 'allow-once' | 'deny';
  actor: string;
  reason: string;
}

export interface Authorization {
  allowed: boolean;
  reason: string;
  token?: string;
}

export type AskHuman = (question: ApprovalQuestion) => Promise<HumanAnswer>;

export interface ToolCallParams {
  tool: string;
  args: Record<string, unknown>;
  domain?: string;
  readOnly?: boolean;
  actionId?: string;
}

export interface ToolAuthorization {
  allowed: boolean;
  decision: 'allow' | 'deny';
  reason: string;
  actor?: string;
  token?: string;
}

export interface ContractApprovalParams {
  domain?: string;
  version: string;
  candidateCommit: string;
  responsible: string;
  justification: string;
  meaningReviewJustification?: string;
  changes?: Array<{ type: string; detail: string }>;
}

export function isMutatingTool(name: string, readOnlyOverride?: boolean): boolean {
  if (readOnlyOverride === true) return false;
  if (readOnlyOverride === false) return true;
  const lower = name.toLowerCase();
  if (['read_file', 'list_directory', 'search_code', 'find_files', 'inspect_skill'].includes(lower)) {
    return false;
  }
  if (['write_file', 'replace_file_content', 'run_bash_command'].includes(lower)) {
    return true;
  }
  return (
    lower.includes('mutate') ||
    lower.includes('write') ||
    lower.includes('create') ||
    lower.includes('delete') ||
    lower.includes('remove') ||
    lower.includes('update') ||
    lower.includes('patch') ||
    lower.includes('modify') ||
    lower.includes('edit') ||
    lower.includes('execute') ||
    lower.includes('run') ||
    lower.includes('apply') ||
    lower.includes('post') ||
    lower.includes('put') ||
    lower.includes('send')
  );
}

export class ApprovalBroker {
  private readonly grants = new Map<string, string>();
  private readonly usedActions = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly ask?: AskHuman,
    private readonly timeoutMs = 30_000,
    private readonly secrets: readonly string[] = []
  ) {}

  async authorizeToolCall(call: ToolCallParams): Promise<ToolAuthorization> {
    const actionId = call.actionId || randomUUID();
    const domain = call.domain || 'default';
    const mutates = isMutatingTool(call.tool, call.readOnly);

    // If tool was declared readOnly but attempts a mutating action
    if (call.readOnly === true && isMutatingTool(call.tool, false)) {
      const reason = `Tool '${call.tool}' is declared read-only but attempted a mutating action`;
      const event: AuditEvent = {
        time: new Date().toISOString(),
        actionId,
        domain,
        actionDigest: '',
        snapshotDigest: '',
        rules: [],
        evaluation: 'deny-on-failure',
        confidence: 'complete',
        decision: 'deny',
        reason,
        tool: call.tool,
        authorizedArguments: call.args,
        result: 'DENIED_READONLY_VIOLATION',
      };
      await appendAudit(this.root, event, this.secrets).catch(() => undefined);
      return { allowed: false, decision: 'deny', reason };
    }

    // Non-mutating read actions are authorized as read-only
    if (!mutates) {
      const reason = `Read-only tool '${call.tool}' authorized`;
      const event: AuditEvent = {
        time: new Date().toISOString(),
        actionId,
        domain,
        actionDigest: '',
        snapshotDigest: '',
        rules: [],
        evaluation: 'allow',
        confidence: 'complete',
        decision: 'allow',
        reason,
        tool: call.tool,
        authorizedArguments: call.args,
        result: 'AUTHORIZED_READONLY',
      };
      await appendAudit(this.root, event, this.secrets).catch(() => undefined);
      return { allowed: true, decision: 'allow', reason };
    }

    // Mutating tool requires authorization decision
    let decision: 'allow' | 'deny' = 'deny';
    let actor: string | undefined;
    let reason = `Mutating tool '${call.tool}' requires authorization`;

    if (this.ask) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const question: ApprovalQuestion = {
          action: {
            id: actionId,
            tool: call.tool,
            arguments: call.args,
            domain,
            mutates: true,
            intercepted: true,
          },
          evaluation: {
            status: 'needs-human',
            actionId,
            domain,
            snapshotDigest: '',
            actionDigest: '',
            rules: [],
            reasons: [reason],
            confidence: 'complete',
          },
          choices: ['allow-once', 'deny'],
        };

        const answer = await Promise.race([
          this.ask(question),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Tempo limite da pergunta excedido')), this.timeoutMs);
          }),
        ]);

        actor = answer.actor;
        reason = answer.reason;
        if (answer.choice === 'allow-once' && actor?.trim() && reason?.trim()) {
          decision = 'allow';
        }
      } catch (err: unknown) {
        decision = 'deny';
        reason = err instanceof Error ? err.message : String(err);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } else {
      decision = 'deny';
      reason = `Mutating tool '${call.tool}' denied: human approval required`;
    }

    const event: AuditEvent = {
      time: new Date().toISOString(),
      actionId,
      domain,
      actionDigest: '',
      snapshotDigest: '',
      rules: [],
      evaluation: decision === 'allow' ? 'allow' : 'needs-human',
      confidence: 'complete',
      decision,
      actor,
      reason,
      tool: call.tool,
      authorizedArguments: decision === 'allow' ? call.args : undefined,
      result: decision === 'allow' ? 'AUTHORIZED' : 'DENIED',
    };
    await appendAudit(this.root, event, this.secrets).catch(() => undefined);

    if (decision === 'deny') {
      return { allowed: false, decision: 'deny', reason };
    }

    const token = randomUUID();
    return { allowed: true, decision: 'allow', reason, actor, token };
  }

  async recordToolResult(actionId: string, tool: string, result: string, domain = 'default'): Promise<void> {
    const event: AuditEvent = {
      time: new Date().toISOString(),
      actionId,
      domain,
      actionDigest: '',
      snapshotDigest: '',
      rules: [],
      evaluation: 'executed',
      confidence: 'complete',
      decision: 'allow',
      reason: 'Tool execution completed',
      tool,
      result,
    };
    await appendAudit(this.root, event, this.secrets).catch(() => undefined);
  }

  async approveContractChange(params: ContractApprovalParams): Promise<void> {
    if (!params.responsible?.trim()) {
      throw new Error('Responsável obrigatório para aprovação de contrato de domínio');
    }
    if (!params.justification?.trim()) {
      throw new Error('Justificativa obrigatória para aprovação de contrato de domínio');
    }
    if (!params.version?.trim()) {
      throw new Error('Versão obrigatória para aprovação de contrato de domínio');
    }
    if (!params.candidateCommit?.trim()) {
      throw new Error('Commit do candidato obrigatório para aprovação de contrato');
    }

    const actionId = `contract-approval-${params.candidateCommit}`;
    const domain = params.domain || 'default';
    const event: AuditEvent = {
      time: new Date().toISOString(),
      actionId,
      domain,
      actionDigest: '',
      snapshotDigest: '',
      rules: ['domain-contract-approval'],
      evaluation: 'contract-approval',
      confidence: 'complete',
      decision: 'allow',
      actor: params.responsible.trim(),
      reason: params.justification.trim(),
      candidateCommit: params.candidateCommit.trim(),
      responsible: params.responsible.trim(),
      justification: params.justification.trim(),
      version: params.version.trim(),
      meaningReviewJustification: params.meaningReviewJustification?.trim(),
      result: 'CONTRACT_APPROVED',
      authorizedArguments: {
        version: params.version.trim(),
        responsible: params.responsible.trim(),
        justification: params.justification.trim(),
        meaningReviewJustification: params.meaningReviewJustification?.trim(),
        changes: params.changes ?? [],
      },
    };
    await appendAudit(this.root, event, this.secrets);
  }

  async authorize(action: ProposedAction, evaluation: ActionEvaluation, snapshot: OntologySnapshot): Promise<Authorization> {
    let decision: 'allow' | 'deny' = 'deny';
    let actor: string | undefined;
    let reason = evaluation.reasons.join('; ');
    const key = `${snapshot.digest}:${action.id}`;
    if (this.usedActions.has(key)) {
      reason = 'Identificador de ação já utilizado';
    } else if (evaluation.actionDigest !== actionDigest(action, snapshot.digest) || evaluation.snapshotDigest !== snapshot.digest) {
      reason = 'Ação, argumentos ou retrato divergentes da avaliação';
    } else {
      try {
        await assertOntologySnapshot(this.root, snapshot);
        if (evaluation.status === 'allow') {
          decision = 'allow';
        } else if (evaluation.status === 'needs-human') {
          if (this.ask) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const answer = await Promise.race([
                this.ask({ action: structuredClone(action), evaluation: structuredClone(evaluation), choices: ['allow-once', 'deny'] }),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo limite da pergunta excedido')), this.timeoutMs); }),
              ]);
              actor = answer.actor;
              reason = answer.reason;
              if (answer.choice === 'allow-once' && actor.trim() && reason.trim()) decision = 'allow';
            } finally {
              if (timer) clearTimeout(timer);
            }
          } else {
            decision = 'deny';
            reason = 'Revisão humana necessária mas nenhum aprovador configurado';
          }
        }
        await assertOntologySnapshot(this.root, snapshot);
        if (evaluation.actionDigest !== actionDigest(action, snapshot.digest)) {
          decision = 'deny';
          reason = 'Argumentos alterados após a pergunta';
        }
      } catch (error) {
        decision = 'deny';
        reason = error instanceof Error ? error.message : String(error);
      }
    }

    const event: AuditEvent = {
      time: new Date().toISOString(), actionId: action.id, domain: action.domain,
      actionDigest: evaluation.actionDigest, snapshotDigest: snapshot.digest, rules: evaluation.rules,
      evaluation: evaluation.status, confidence: evaluation.confidence, decision, actor, reason,
    };
    try {
      await appendAudit(this.root, event, this.secrets);
    } catch {
      return { allowed: false, reason: 'Falha ao persistir auditoria; ação negada' };
    }
    this.usedActions.add(key);
    if (decision === 'deny') return { allowed: false, reason };
    const token = randomUUID();
    this.grants.set(token, evaluation.actionDigest);
    return { allowed: true, reason, token };
  }

  async consume(token: string, action: ProposedAction, snapshot: OntologySnapshot): Promise<boolean> {
    const digest = this.grants.get(token);
    this.grants.delete(token);
    if (digest === undefined || digest !== actionDigest(action, snapshot.digest)) return false;
    try {
      await assertOntologySnapshot(this.root, snapshot);
      return true;
    } catch {
      return false;
    }
  }
}
