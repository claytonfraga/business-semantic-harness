import type { GovernanceDecision } from '../enforcement/governanceDecision.js';

export interface ContentArtifact {
  id: string;
  role: 'CANDIDATE' | 'BASE' | 'CONTRACT' | 'POLICY' | 'CORRESPONDENCE' | 'ADAPTER' | 'CONTEXT' | 'FACTS' | 'QUERY_RESULT';
  sha256: string;
  content: string;
  source: string;
}

export interface ExperimentCondition {
  id: string;
  context: 'NONE' | 'TEXT_RULES' | 'STRUCTURED_QUERY' | 'SPARQL_QUERY';
  enforcement: boolean;
  policyId: string;
  policyHash: string;
}

export interface ExperimentControls {
  agent: string;
  agentVersion: string;
  model: string;
  taskId: string;
  taskPrompt: string;
  /** Identity of the base system prompt, before experimental context is appended. */
  systemPromptHash?: string;
  baseHash: string;
  budget: { maxTokens: number; maxTurns: number; timeoutMs: number };
  technicalGates: string[];
}

export interface QueryObservation {
  id: string;
  mechanism: 'STRUCTURED' | 'SPARQL' | 'SHACL_SPARQL';
  purpose: 'AGENT_CONTEXT' | 'AUTHORIZATION_EVIDENCE';
  query: string;
  sourceHash: string;
  result: unknown;
  status: 'SUCCESS' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'LIMIT_EXCEEDED' | 'UNSUPPORTED';
  durationMs: number | null;
  tokens: number | null;
}

export type RunStatus = 'ACCEPTED' | 'DENIED' | 'REFUSED' | 'NO_CANDIDATE' | 'TECHNICAL_FAILURE' |
  'MISSING_EVIDENCE' | 'TIMEOUT' | 'ERROR' | 'UNSUPPORTED';
export type CostPhase = 'QUERY' | 'EXTRACTION' | 'VALIDATION' | 'PACKAGE_PREPARATION' |
  'PACKAGE_MAINTENANCE' | 'GENERATION' | 'TECHNICAL_GATES' | 'HUMAN_REVIEW';
export interface CostObservation {
  phase: CostPhase;
  kind: 'DEPLOYMENT' | 'RECURRING';
  durationMs: number | null;
  tokens: number | null;
  amount: number | null;
  currency: string | null;
}

export interface ExplanationClaim {
  recordId: string;
  reference: string;
  fieldPath: string;
  expectedValue: unknown;
}

export interface ExternalSourceSnapshot {
  id: string;
  source: string;
  sha256: string;
  content: string;
  consistencyPolicy: 'SNAPSHOT_PINNED' | 'STRICT_IMMUTABLE' | 'REVALIDATE_ON_DECISION';
}

export interface TransferObservation {
  sourceProject: string;
  targetProject: string;
  reusedArtifacts: Array<{ id: string; sha256: string; source: string }>;
  adaptedArtifacts: Array<{ id: string; beforeHash: string; afterHash: string }>;
  adaptationMs: number | null;
  reviewMs: number | null;
  humanWorkMs: number | null;
  description: string;
  costs: CostObservation[];
}

export interface ExperimentRun {
  schemaVersion: 1;
  runId: string;
  replicateId?: string;
  batchId: string;
  track: 'FIXED_CANDIDATE' | 'AGENT_GENERATION';
  projectId: string;
  domain: string;
  technology: string;
  condition: ExperimentCondition;
  controls: ExperimentControls;
  candidate: { id: string; contentHash: string; commit: string | null; baseCommit: string | null } | null;
  oracle: { verdict: 'VALID' | 'INVALID' | 'INDETERMINATE'; reference: string; sha256: string };
  status: RunStatus;
  promotionDecision: 'ALLOW' | 'DENY' | 'REVALIDATION_REQUIRED' | 'NOT_ATTEMPTED';
  promoted: boolean;
  validated: boolean;
  semanticStatus: 'CONFORMING' | 'VIOLATION' | 'INDETERMINATE' | 'VALIDATION_ERROR' | null;
  failureStage: string | null;
  queries: QueryObservation[];
  artifacts: ContentArtifact[];
  sources: ExternalSourceSnapshot[];
  adapterIds: Array<{ id: string; version: string; sha256: string }>;
  factsHash: string | null;
  expectedRuleIds: string[];
  evaluatedRuleIds: string[];
  expectedEvidenceIds: string[];
  evaluatedEvidenceIds: string[];
  decisionRecords: Array<{ id: string; references: string[]; record: unknown }>;
  explanation: ExplanationClaim[] | null;
  humanReview: { reviewMs: number | null; workMs: number | null; description: string } | null;
  costs: CostObservation[];
  expectedCostPhases?: Array<{ phase: CostPhase; kind: 'DEPLOYMENT' | 'RECURRING' }>;
  transfer: TransferObservation | null;
  governanceDecision?: GovernanceDecision;
  limitations: string[];
}

export interface ProductComparison {
  product: string;
  governedObject: string;
  executionPoints: string[];
  evidenceReference: string;
}
