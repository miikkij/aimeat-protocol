/**
 * @file src/services/app-grant-upsert.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place an owner's live grant for an app is written: refresh the existing row,
 *   else create it. The silent bridge and the authorization_code exchange (routes/app-grants.ts) and
 *   the install set's grants (services/install-set-grants.ts) all write through here, so none of them
 *   can stack a second live grant for the same (owner, app).
 *
 *   PURE EXTRACTION from routes/app-grants.ts on 2026-10-04 (it was the closure upsertGrant), moved
 *   so a service can write a grant without a second implementation. Nothing in it was rewritten;
 *   `storage` is a parameter instead of the router's closure.
 * @structure hashGrantToken() · GrantSpec · upsertAppGrant()
 * @usage const { grantId, rawRefresh, scopes } = await upsertAppGrant(storage, spec, existing);
 * @version-history
 *   v1.0.0 — 2026-10-04 — Extracted verbatim from routes/app-grants.ts (upsertGrant).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Storage, AppGrantRecord } from '../storage/interface.js';
import { afterApproval, withAppPurge } from './app-grant-scopes.js';

/** SHA-256 hex (refresh-token storage). */
export function hashGrantToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface GrantSpec {
  app: string; appName: string; appOrigin: string; owner: string; gaii: string; scopes: string[]; shown?: string[];
}

/**
 * Establish the owner's SINGLE live grant for an app: refresh the existing one, else create it.
 * `existing` is passed in because callers have already looked it up to make their own policy
 * decision — no second query on the hot silent path.
 *
 * Scopes are replaced by what was just approved, never unioned: the consent screen's Advanced
 * subset must be able to take access away, not only add it. The one exception is a word the OWNER
 * added by hand: it stays unless the consent screen listed it (`spec.shown`) and the owner left it
 * unticked (services/app-grant-scopes.ts afterApproval). The answer carries the scopes written.
 *
 * The partial unique index on (owner, app) WHERE NOT revoked makes the invariant a DB guarantee,
 * so two simultaneous first-time consents surface as a constraint violation instead of a duplicate
 * row. Rather than failing the exchange, adopt the row that won the race.
 */
export async function upsertAppGrant(
  storage: Storage,
  spec: GrantSpec,
  existing: AppGrantRecord | null,
): Promise<{ grantId: string; rawRefresh: string; scopes: string[] }> {
  // An app's delete reaches workspace records for good as it always did (services/app-grant-scopes.ts).
  spec = { ...spec, scopes: withAppPurge(spec.scopes) };
  const rawRefresh = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const patchFor = (row: AppGrantRecord | null) => {
    const next = afterApproval(spec.scopes, row, spec.shown ?? []);
    return { refreshTokenHash: hashGrantToken(rawRefresh), lastUsedAt: now, scopes: next.scopes, ownerAddedScopes: next.ownerAddedScopes };
  };
  if (existing) {
    const patch = patchFor(existing);
    await storage.updateAppGrant(existing.grantId, patch);
    return { grantId: existing.grantId, rawRefresh, scopes: patch.scopes };
  }
  const grantId = `appgrant-${randomBytes(16).toString('hex')}`;
  try {
    await storage.createAppGrant({
      grantId, app: spec.app, appName: spec.appName, appOrigin: spec.appOrigin,
      owner: spec.owner, gaii: spec.gaii, scopes: spec.scopes,
      refreshTokenHash: hashGrantToken(rawRefresh), createdAt: now, lastUsedAt: now, revoked: false,
    });
    return { grantId, rawRefresh, scopes: spec.scopes };
  } catch (err) {
    const raced = await storage.getAppGrantByOwnerAndApp(spec.owner, spec.app);
    if (!raced) throw err; // a genuine storage failure, not the unique-index race
    const patch = patchFor(raced);
    await storage.updateAppGrant(raced.grantId, patch);
    return { grantId: raced.grantId, rawRefresh, scopes: patch.scopes };
  }
}
