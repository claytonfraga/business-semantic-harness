declare module 'shacl-engine' {
  export class Validator {
    constructor(shapes: unknown, options?: Record<string, unknown>);
    validate(options: { dataset: unknown; terms?: unknown }, shapes?: Array<{ terms: unknown[] }>): Promise<{
      conforms: boolean;
      results: EngineResult[];
    }>;
  }
  export interface EngineResult {
    shape?: { ptr?: { term?: { value: string; termType?: string } } };
    focusNode?: { term?: { value: string; termType?: string }; values?: string[] };
    message?: Array<{ value: string }>;
    severity?: { value: string };
    constraintComponent?: { value: string };
    source?: Array<{ value: string; termType?: string }>;
    results?: EngineResult[];
  }
}

declare module 'shacl-engine/sparql.js' {
  export const targetResolvers: unknown[];
  export const validations: unknown[];
}
