import type { SystemPromptRecord, SystemPromptVersionRecord } from '../interface.js';

export interface SystemPromptRepository {
  listSystemPrompts(): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<void>;
  listSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  saveSystemPromptVersion(record: SystemPromptVersionRecord): Promise<void>;
}
