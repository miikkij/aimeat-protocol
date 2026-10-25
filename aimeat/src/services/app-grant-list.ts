/**
 * @file app-grant-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's list of the app grants that still hold: which apps may act in their
 *   account, with which words, and what each may spend. One implementation for GET /v1/app-grants
 *   and for any tool that answers the same question, so the two cannot show different lists.
 *   Revoked grants are left out. Revoking or narrowing a grant is not here: those stay the owner's
 *   own doors in routes/app-grants-manage.ts.
 * @structure
 *   - AppGrantListEntry: one grant as the wire shows it (snake_case)
 *   - listActiveAppGrants(storage, ownerName): the owner's live grants and their count
 * @usage
 *   import { listActiveAppGrants } from '../services/app-grant-list.js';
 *   const { grants, total } = await listActiveAppGrants(storage, ownerName);
 * @version-history
 *   2026-10-25 — A grant given to an app of an earlier holder of the author's name is left out
 *     (services/app-grant-author.ts; secaudit2026oct22).
 *   v1.0.0 — 2026-09-27 — Extracted from GET /v1/app-grants (routes/app-grants-manage.ts v1.2.0),
 *     same shape, when an agent holding consent:manage was allowed to read the list.
 */
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { heldOwnerAdded } from './app-grant-scopes.js';
import { grantGivenToEarlierAuthor } from './app-grant-author.js';

/** One live app grant, in the shape GET /v1/app-grants answers. */
export interface AppGrantListEntry {
  grant_id: string;
  app: string;
  app_name: string;
  app_origin: string;
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
  /** Only meaningful for an app that may spend at all; the UI hides the control otherwise. */
  can_spend: boolean;
  spend_cap_morsels: number | null;
  spent_morsels: number;
  scopes_fixed_at: string | null;
  /** The words the owner added by hand, which stay when the app's own declaration shrinks. */
  owner_added_scopes: string[];
}

/**
 * The owner's grants that are not revoked. `ownerName` is the bare account name, the key app grants
 * are stored under (AppGrantRecord.owner); the caller takes it from its own session, never from input.
 */
export async function listActiveAppGrants(
  storage: Storage,
  ownerName: string,
): Promise<{ grants: AppGrantListEntry[]; total: number }> {
  // A grant given to an app of an earlier holder of the author's name holds nothing any more
  // (services/app-grant-author.ts), so it is not listed as live, and the consent page does not
  // approve the new holder's app on it (secaudit2026oct22).
  const authors = new Map<string, string | null>();
  const grants: AppGrantRecord[] = [];
  for (const g of await storage.listAppGrantsByOwner(ownerName)) {
    if (!g.revoked && !(await grantGivenToEarlierAuthor(storage, g, authors))) grants.push(g);
  }
  return {
    grants: grants.map(g => ({
      grant_id: g.grantId, app: g.app, app_name: g.appName, app_origin: g.appOrigin,
      scopes: g.scopes, granted_at: g.createdAt, last_used_at: g.lastUsedAt,
      can_spend: (g.scopes ?? []).includes('contract:spend'),
      spend_cap_morsels: g.spendCapMorsels ?? null,
      spent_morsels: g.spentMorsels ?? 0,
      scopes_fixed_at: g.scopesFixedAt ?? null,
      owner_added_scopes: heldOwnerAdded(g),
    })),
    total: grants.length,
  };
}
