declare module 'shacl-engine' {
  export class Validator {
    constructor(shapes: unknown, options?: Record<string, unknown>);
    validate(options: { dataset: unknown; terms?: unknown }): Promise<{
      conforms: boolean;
      results: Array<{
        shape?: { ptr?: { term?: { value: string } } };
        focusNode?: { term?: { value: string }; values?: string[] };
        message?: Array<{ value: string }>;
        severity?: { value: string };
        constraintComponent?: { value: string };
      }>;
    }>;
  }
}

declare module 'shacl-engine/sparql.js' {
  export const targetResolvers: unknown[];
  export const validations: unknown[];
}
