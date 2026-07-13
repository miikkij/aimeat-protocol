/**
 * @file src/storage/repositories/system-prompt.repository.ts
 * @description Storage-backend-agnostic interface for managed system prompts and their version
 *   history — upsert, lookup by id/group, list, and version create/prune. Backs the DB-served
 *   prompts (e.g. GET /v1/prompts/:name). Implemented per backend.
 *
 * @structure
 *   - SystemPromptRepository: list/get/upsert prompts; get/create/prune versions; deleteAll
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { SystemPromptRecord, SystemPromptVersionRecord } from '../interface.js';

export interface SystemPromptRepository {
  listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord>;
  getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord>;
  pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number>;
  deleteAllSystemPrompts(): Promise<void>;
}
