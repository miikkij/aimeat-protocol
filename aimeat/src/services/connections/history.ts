/**
 * @file history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a principal has published through this node, and the replies to one item of
 *   it: the two reads the REST routes and the MCP tools share (2026-10-15). Moved here from the
 *   route so the MCP door calls the same function instead of a second copy of the lookup and the
 *   ownership check.
 *
 *   ABSENT AND NOT-YOURS ANSWER ALIKE, as everywhere in connections: an attempt id of somebody
 *   else's answers NOT_FOUND with the same sentence as one that never existed.
 *
 *   WHOSE ITEMS. Both reads take the HOLDERS the caller may read (services/connections/access.ts
 *   connectionHoldersOf, purpose 'read'): the caller always, and the owner too when an agent holds
 *   connections:read-as-owner, the word the owner ticks by hand and no wildcard covers. Without it
 *   an agent reads only what it published itself, so a reply-reading agent saw nothing of what its
 *   owner sent from LÄHETIN (Jouni, 2026-10-16: an agent may read the owner's publish history and
 *   the replies with the owner's permission). Reading only: publishing stays on the caller's own
 *   connections and connections:use.
 * @structure listPublishHistory · repliesForAttempt
 * @usage const items = await listPublishHistory(storage, holders, 50);
 * @version-history
 *   v1.1.0 — 2026-10-16 — Both reads take the holders instead of one principal, so an agent with
 *     connections:read-as-owner reads its owner's items; each history item says whose it is
 *     (`holder`: own | owner).
 *   v1.0.0 — 2026-10-15 — The history projection moved from routes/connections.ts unchanged;
 *     repliesForAttempt is new.
 */

import type { Storage } from '../../storage/interface.js';
import type { PublishHistoryItem } from '../../models/connection-schemas.js';
import { findProvider } from './providers.js';
import { ensureFreshCredential } from './refresh.js';
import type { ConnectContext } from './oauth.js';
import { readReplies, type Reply } from './replies.js';

/**
 * The history of every holder the caller may read, newest first. `holders[0]` is the caller; a
 * second holder is the owner (connectionHoldersOf). One lookup per kind and holder, never one per row.
 */
export async function listPublishHistory(
  storage: Storage, holders: readonly string[], limit: number,
): Promise<PublishHistoryItem[]> {
  const cap = Math.min(Math.max(limit, 1), 200);
  const perHolder = await Promise.all(holders.map(h => storage.listPublishAttempts({ publisher: h })));
  const attempts = perHolder.flat()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, cap);
  const [metrics, ...connectionLists] = await Promise.all([
    storage.latestPublishMetrics(attempts.map(a => a.id)),
    ...holders.map(h => storage.listConnections({ principal: h })),
  ]);
  const byId = new Map(connectionLists.flat().map(c => [c.id, c]));
  return attempts.map(a => {
    const c = byId.get(a.connectionId);
    return {
      id: a.id,
      holder: a.publisher === holders[0] ? 'own' as const : 'owner' as const,
      connectionId: a.connectionId,
      // A connection that has since been disconnected leaves its history behind. Saying
      // "(disconnected)" beats a blank where an account name should be.
      provider: c?.provider ?? 'unknown',
      accountLabel: c?.accountLabel ?? '(disconnected)',
      status: a.status,
      externalRef: a.externalRef,
      storageKey: a.storageKey,
      error: a.error,
      createdAt: a.createdAt,
      latest: metrics.get(a.id) ?? null,
    };
  });
}

export type RepliesForAttempt =
  | { ok: true; attemptId: string; provider: string; url: string; replies: Reply[]; truncated: boolean; note?: string; fetchedAt: string }
  | { ok: false; status: 400 | 404 | 409 | 502 | 503; code: string; reason: string };

/**
 * The replies to one item a holder published (the caller, or the owner on read-as-owner). A refusal
 * the platform will never change is a 409 NOT_READABLE (LinkedIn, comments turned off, a deleted
 * post); one that may pass is a 502.
 */
export async function repliesForAttempt(
  ctx: ConnectContext, holders: readonly string[], attemptId: string, limit?: number,
): Promise<RepliesForAttempt> {
  const { storage } = ctx;
  const attempt = await storage.getPublishAttempt(attemptId);
  if (!attempt || !holders.includes(attempt.publisher)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', reason: 'no such published item of yours' };
  }
  if (attempt.status !== 'done' || !attempt.externalRef) {
    return { ok: false, status: 400, code: 'NOT_PUBLISHED', reason: 'that item was never published, so nobody could answer it' };
  }
  // The account must be the publisher's own: an item never reads through somebody else's credential.
  const connection = await storage.getConnection(attempt.connectionId);
  if (!connection || connection.principal !== attempt.publisher) {
    return { ok: false, status: 404, code: 'NOT_FOUND', reason: 'the account it went to is gone' };
  }
  const provider = findProvider(ctx.providers, connection.provider);
  if (!provider) return { ok: false, status: 400, code: 'PROVIDER_GONE', reason: 'that provider is no longer available' };

  const fresh = await ensureFreshCredential(ctx, connection.id);
  if (!fresh.ok) return { ok: false, status: 400, code: fresh.code, reason: fresh.reason };

  const out = await readReplies({
    provider, connection: fresh.connection, credential: fresh.credential, externalRef: attempt.externalRef, limit,
  });
  if (!out.ok) {
    return {
      ok: false, status: out.permanent ? 409 : 502,
      code: out.permanent ? 'NOT_READABLE' : 'REPLIES_UNAVAILABLE', reason: out.reason,
    };
  }
  return {
    ok: true, attemptId: attempt.id, provider: provider.id, url: attempt.externalRef,
    replies: out.replies, truncated: out.truncated, ...(out.note ? { note: out.note } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
