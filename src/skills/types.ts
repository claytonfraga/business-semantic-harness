export type SkillScope = 'project' | 'global';

export interface SkillMetadata {
  name: string;
  description: string;
  tags?: string[];
  version?: string;
  author?: string;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  description: string;
  scope: SkillScope;
  filePath: string;
  sourceHash: string;
  directoryPath: string;
  body: string;
  metadata: SkillMetadata;
  associatedFiles: string[];
}

export interface SkillRegistryOptions {
  projectRoot?: string;
  customRoots?: string[];
  enableGlobal?: boolean;
}
