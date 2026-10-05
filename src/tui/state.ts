import type { SlashMenuOverlayState } from "./slashCommands.js";

export interface RenderState {
  model: string;
  contextLength?: number;
  domain?: string;
  ontologySummary?: string;
  projectFolder?: string;
  gitBranch?: string;
  governed: boolean;
  alignmentStatus?: 'ALIGNED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  alignmentWarning?: string;
  tokensTotal: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  tokensCached?: number;
  tokensReasoning?: number;
  telemetryStatus?: 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE';
  sessionCost?: number;
  width?: number;
  height?: number;
  scrollOffset?: number;
  generationDurationMs?: number;
  generationTps?: number;
  queueLength?: number;
  ctrlCExitAlert?: boolean;
  activeSkill?: string;
  slashMenu?: SlashMenuOverlayState;
}

export interface GateCheckItem {
  ok: boolean;
  text: string;
  ruleId?: string;
  shapeIri?: string;
  property?: string;
  reference?: string;
}

export interface ReceiptFileStat {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface ChatEntry {
  type: 'user' | 'agent' | 'tool' | 'tool_result' | 'gate' | 'alert' | 'prompt_violation' | 'implementation_receipt' | 'reasoning' | 'diff_preview' | 'blank';
  content?: string;
  isViolating?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown> | string;
  isError?: boolean;
  verbose?: boolean;
  gateShape?: string;
  gateChecks?: GateCheckItem[];
  gateStatus?: 'CONFORMING' | 'VIOLATION' | 'INDETERMINATE' | 'HUMAN_REVIEW_REQUIRED' | 'VALIDATION_ERROR' | 'NO_CHANGES';
  gateScope?: string;
  gateIsPreliminary?: boolean;
  gateDisclaimer?: string;
  gateOperations?: string[];
  gateRestrictions?: string[];
  gateEvidences?: string[];
  gateReasons?: string[];
  gateReferences?: Record<string, unknown>;
  violationShape?: string;
  violationRule?: string;
  violationOperation?: string;
  violationBusinessRationale?: string;
  violationRemediation?: string[];
  alertDiagnostic?: string;
  alertRemediation?: string[];
  waitingConfirmation?: boolean;
  requestDecision?: import('../governance/requestPreparation.js').RequestPreparationStatus;
  receiptFiles?: ReceiptFileStat[];
  receiptTotalAdded?: number;
  receiptTotalRemoved?: number;
  receiptHasChanges?: boolean;
  receiptOutcome?: import('../agent/agentLoop.js').AgentTurnResult['outcome'];
  receiptDiagnostics?: string[];
  isQueued?: boolean;
  reasoningCollapsed?: boolean;
  reasoningTokens?: number;
  reasoningDurationMs?: number;
  diffFiles?: ReceiptFileStat[];
  diffTotalAdded?: number;
  diffTotalRemoved?: number;
}
