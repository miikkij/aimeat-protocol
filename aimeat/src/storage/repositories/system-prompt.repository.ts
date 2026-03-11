import type { SystemPromptRecord, SystemPromptVersionRecord } from '../interface.js';

export interface SystemPromptRepository {
  listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord>;
  getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord>;
  pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number>;
}
