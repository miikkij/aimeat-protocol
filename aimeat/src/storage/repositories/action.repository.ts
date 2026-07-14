/**
 * @file src/storage/repositories/action.repository.ts
 * @description Storage-interface segment for action definitions — the CRUD contract each backend
 *   must implement for provider-owned actions (create, get, list, delete, list/delete by provider, update).
 *
 * @structure
 *   - ActionRepository: interface with createAction, getAction, listActions, deleteAction,
 *     deleteActionsByProvider, listActionsByProvider, updateAction
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ActionRecord } from '../interface.js';

export interface ActionRepository {
  createAction(action: ActionRecord): Promise<ActionRecord>;
  getAction(id: string, providerGaii: string): Promise<ActionRecord | null>;
  listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]>;
  deleteAction(id: string, providerGaii: string): Promise<boolean>;
  deleteActionsByProvider(gaii: string): Promise<number>;
  listActionsByProvider(gaii: string): Promise<ActionRecord[]>;
  /** COUNT of actions across MANY provider GAIIs in one query (owner-scope "services used" figure). */
  countActionsForProviders(providerGaiis: string[]): Promise<number>;
  updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null>;
}
