/**
 * Deterministic, domain-agnostic orientation for requests that are not sent to
 * the model. It never calls a provider, never asserts candidate conformity and
 * never changes the prepared decision: it only explains what was recognized,
 * suggests the closest governed operation and lists actionable next steps.
 */
export type RemediationStatus = 'ALLOW' | 'BLOCK' | 'HUMAN_REVIEW' | 'INSUFFICIENT_INFORMATION' | 'CONFIGURATION_ERROR';

export interface RemediationOperation {
  iri: string;
  name: string;
  terms: string[];
}

export interface RequestRemediationInput {
  status: RemediationStatus;
  domainId?: string;
  requestText: string;
  selectedConcepts: string[];
  governedOperations: RemediationOperation[];
  policyReferences: string[];
  diagnosticCode?: 'DOMAIN_NOT_FOUND' | 'INVALID_CONFIGURATION' | 'READ_ERROR' | 'DEPENDENCY_UNAVAILABLE';
  reason?: string;
  identifiedOperations?: string[];
  entryPoint?: 'tui' | 'headless';
}

const MAX_TERM_LENGTH = 40;

function tokenize(value: string): string[] {
  const raw = value.normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length > 2) tokens.push(token.toLowerCase());
    else if (token.length === 2 && /^[A-Z0-9]{2}$/.test(token)) tokens.push(token.toLowerCase());
  }
  return tokens;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length, MAX_TERM_LENGTH);
  let index = 0;
  while (index < limit && a[index] === b[index]) index++;
  return index;
}

function similarity(requestTokens: string[], terms: string[]): number {
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const token of requestTokens) {
      if (token === term) { best = 1; break; }
      if (commonPrefixLength(token, term) >= 5) best = Math.max(best, 0.75);
    }
    score += best;
  }
  return score / terms.length;
}

export function closestGovernedOperation(input: RequestRemediationInput): RemediationOperation | undefined {
  const requestTokens = tokenize(input.requestText);
  let closest: RemediationOperation | undefined;
  let bestScore = 0;
  for (const operation of input.governedOperations) {
    const score = similarity(requestTokens, operation.terms);
    if (score > bestScore) { bestScore = score; closest = operation; }
  }
  return bestScore > 0 ? closest : undefined;
}

export function buildRequestRemediation(input: RequestRemediationInput): string[] {
  const lines: string[] = [];
  if (input.status === 'ALLOW') return lines;
  const exits = input.entryPoint === 'headless'
    ? 'rephrase and rerun; use --domain to select another declared domain; explicitly use --ungoverned only if you choose execution without semantic governance.'
    : 'rephrase the request; /domain to switch domain; /ungoverned to explicitly select execution without semantic governance.';
  if (input.status === 'CONFIGURATION_ERROR') {
    lines.push(`Configuration cause [${input.diagnosticCode ?? 'INVALID_CONFIGURATION'}]: ${input.reason ?? 'Contract configuration is unavailable.'}`);
    const actions = {
      DOMAIN_NOT_FOUND: 'Select a domain declared in .bsh/project.json or repair its declaration.',
      INVALID_CONFIGURATION: 'Repair the reported manifest or contract error, validate the project ontology, and retry.',
      READ_ERROR: 'Restore the contract file and its read permissions; retry after validating the project.',
      DEPENDENCY_UNAVAILABLE: 'Restore or declare the dependency in this project and satisfy its version requirement; validate and retry.',
    };
    lines.push(actions[input.diagnosticCode ?? 'INVALID_CONFIGURATION'], `Next steps: ${exits}`, 'No request was sent; configuration repair does not approve tools or candidate promotion.');
    return lines;
  }
  const concepts = [...input.selectedConcepts].sort((a, b) => a.localeCompare(b));
  const rules = input.policyReferences;
  if (input.status === 'INSUFFICIENT_INFORMATION') {
    lines.push((input.identifiedOperations?.length ?? 0) > 0
      ? `Operation correspondences were recognized (${input.identifiedOperations?.join(', ')}), but instruction purpose remains uncertain; clarify the requested action before dispatch.`
      : concepts.length > 0
      ? `No governed operation was recognized. Mentioned concepts only: ${concepts.join(', ')}.`
      : 'No governed operation was recognized for this request.');
    if (input.governedOperations.length === 0) {
      lines.push(`The active domain '${input.domainId ?? '(none)'}' declares no governed operations; check the active domain with ${input.entryPoint === 'headless' ? '--domain' : '/domain'}.`);
    } else {
      const closest = closestGovernedOperation(input);
      if (closest) lines.push(`Did you mean ${closest.name}? Rephrase naming the operation and its required attributes.`);
      lines.push(`Governed operations in this domain: ${input.governedOperations.map(operation => operation.name).join(', ')}.`);
    }
    lines.push(`Next steps: ${exits}`);
  } else if (input.status === 'BLOCK') {
    lines.push('The project contract prohibits executing this operation; no request was sent to the model.');
    if (rules.length > 0) lines.push(`Applicable rules: ${rules.join(', ')}.`);
    lines.push(`Next steps: ${exits}`);
  } else if (input.status === 'HUMAN_REVIEW') {
    lines.push('The project contract requires human review before dispatch; tool authorization and promotion remain independent.');
    if (rules.length > 0) lines.push(`Applicable rules: ${rules.join(', ')}.`);
    if (input.reason) lines.push(`Review reason: ${input.reason}`);
    lines.push(input.entryPoint === 'headless'
      ? 'Headless request interrupted: no interactive request approver is available. Use the TUI request-review confirmation, or an authorized host request-review mechanism bound to this request and snapshot; tool approval is not request approval.'
      : 'Approve only through the request-review confirmation bound to this request and snapshot, or cancel the review.');
    lines.push(`Cancel or leave the request unsent. Next steps: ${exits}`);
  }
  return lines;
}
