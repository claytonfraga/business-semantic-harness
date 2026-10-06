import { createHash, randomUUID } from 'node:crypto';
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
  external?: boolean;
}

export interface ToolAuthorization {
  allowed: boolean;
  decision: 'allow' | 'deny';
  reason: string;
  actor?: string;
  token?: string;
}

export class BrokerAuthorizationError extends Error {
  constructor(tool: string, reason: string) {
    super(`Tool '${tool}' denied by approval broker: ${reason}`);
    this.name = 'BrokerAuthorizationError';
  }
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
  // Unknown external tool effects require review unless the host supplies a
  // read-only declaration. A benign name is not evidence of benign effects.
  return true;
}

function contradictsReadOnly(name: string): boolean {
  return /(?:^|_)(?:mutate|write|replace|create|delete|remove|update|patch|modify|edit|execute|run|apply|post|put|send)(?:_|$)/i.test(name);
}

export class ApprovalBroker {
  private readonly grants = new Map<string, string>();
  private readonly usedActions = new Set<string>();
  private readonly usedToolActions = new Set<string>();
  private requestGuard?: () => Promise<void>;

  constructor(
    private readonly root: string,
    private readonly ask?: AskHuman,
    private readonly timeoutMs = 30_000,
    private readonly secrets: readonly string[] = []
  ) {}

  setRequestGuard(guard: (() => Promise<void>) | undefined): void {
    this.requestGuard = guard;
  }

  async authorizeToolCall(call: ToolCallParams): Promise<ToolAuthorization> {
    const actionId = call.actionId || randomUUID();
    const domain = call.domain || 'default';
    const authorizedArgs = structuredClone(call.args);
    const argumentsDigest = createHash('sha256').update(JSON.stringify(authorizedArgs)).digest('hex');
    try {
      if (this.usedToolActions.has(actionId)) throw new Error('Tool action identifier has already been consumed');
      this.usedToolActions.add(actionId);
      await this.requestGuard?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await appendAudit(this.root, {
        time: new Date().toISOString(), actionId, domain, actionDigest: argumentsDigest,
        snapshotDigest: '', rules: [], evaluation: 'deny-on-failure', confidence: 'complete',
        decision: 'deny', reason, tool: call.tool, result: 'DENIED_REQUEST_GUARD',
      }, this.secrets).catch(() => undefined);
      return { allowed: false, decision: 'deny', reason };
    }
    const mutates = call.external && call.readOnly !== true ? true : isMutatingTool(call.tool, call.readOnly);

    // If tool was declared readOnly but attempts a mutating action
    if (call.readOnly === true && contradictsReadOnly(call.tool)) {
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
        authorizedArguments: authorizedArgs,
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
        authorizedArguments: authorizedArgs,
        result: 'AUTHORIZED_READONLY',
      };
      try {
        await appendAudit(this.root, event, this.secrets);
      } catch {
        return { allowed: false, decision: 'deny', reason: 'Failed to persist authorization audit' };
      }
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
            arguments: structuredClone(authorizedArgs),
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
            timer = setTimeout(() => reject(new Error('Human approval timed out')), this.timeoutMs);
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

    try {
      await this.requestGuard?.();
      if (createHash('sha256').update(JSON.stringify(call.args)).digest('hex') !== argumentsDigest) {
        throw new Error('Tool arguments changed while authorization was pending');
      }
    } catch (error) {
      decision = 'deny';
      reason = error instanceof Error ? error.message : String(error);
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
      authorizedArguments: decision === 'allow' ? authorizedArgs : undefined,
      result: decision === 'allow' ? 'AUTHORIZED' : 'DENIED',
    };
    try {
      await appendAudit(this.root, event, this.secrets);
    } catch {
      return { allowed: false, decision: 'deny', reason: 'Failed to persist authorization audit' };
    }

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
