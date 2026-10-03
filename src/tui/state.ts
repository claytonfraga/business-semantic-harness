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
  gateShape?: string;
  gateChecks?: GateCheckItem[];
  gateStatus?: 'CONFORMING' | 'VIOLATION';
  violationShape?: string;
  violationRule?: string;
  waitingConfirmation?: boolean;
  receiptFiles?: ReceiptFileStat[];
  receiptTotalAdded?: number;
  receiptTotalRemoved?: number;
  receiptHasChanges?: boolean;
  isQueued?: boolean;
  reasoningCollapsed?: boolean;
  reasoningTokens?: number;
  reasoningDurationMs?: number;
  diffFiles?: ReceiptFileStat[];
  diffTotalAdded?: number;
  diffTotalRemoved?: number;
}

