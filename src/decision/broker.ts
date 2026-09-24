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

export class ApprovalBroker {
  private readonly grants = new Map<string, string>();
  private readonly usedActions = new Set<string>();

  constructor(private readonly root: string, private readonly ask: AskHuman, private readonly timeoutMs = 30_000, private readonly secrets: readonly string[] = []) {}

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
