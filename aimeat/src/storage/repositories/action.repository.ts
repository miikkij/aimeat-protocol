import type { ActionRecord } from '../interface.js';

export interface ActionRepository {
  createAction(action: ActionRecord): Promise<ActionRecord>;
  getAction(id: string, providerGaii: string): Promise<ActionRecord | null>;
  listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]>;
  deleteAction(id: string, providerGaii: string): Promise<boolean>;
  deleteActionsByProvider(gaii: string): Promise<number>;
  listActionsByProvider(gaii: string): Promise<ActionRecord[]>;
  updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null>;
}
