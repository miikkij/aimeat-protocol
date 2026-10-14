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
 * @structure listPublishHistory · repliesForAttempt
 * @usage const items = await listPublishHistory(storage, principal, 50);
 * @version-history
 *   v1.0.0 — 2026-10-15 — The history projection moved from routes/connections.ts unchanged;
 *     repliesForAttempt is new.
 */

import type { Storage } from '../../storage/interface.js';
import type { PublishHistoryItem } from '../../models/connection-schemas.js';
import { findProvider } from './providers.js';
import { ensureFreshCredential } from './refresh.js';
import type { ConnectContext } from './oauth.js';
import { readReplies, type Reply } from './replies.js';

/** The caller's own history, newest first. One lookup per kind, never one per row. */
export async function listPublishHistory(
  storage: Storage, principal: string, limit: number,
): Promise<PublishHistoryItem[]> {
  const attempts = (await storage.listPublishAttempts({ publisher: principal })).slice(0, Math.min(Math.max(limit, 1), 200));
  const [metrics, connections] = await Promise.all([
    storage.latestPublishMetrics(attempts.map(a => a.id)),
    storage.listConnections({ principal }),
  ]);
  const byId = new Map(connections.map(c => [c.id, c]));
  return attempts.map(a => {
    const c = byId.get(a.connectionId);
    return {
      id: a.id,
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
 * The replies to one item the principal published. A refusal the platform will never change is a
 * 409 NOT_READABLE (LinkedIn, comments turned off, a deleted post); one that may pass is a 502.
 */
export async function repliesForAttempt(
  ctx: ConnectContext, principal: string, attemptId: string, limit?: number,
): Promise<RepliesForAttempt> {
  const { storage } = ctx;
  const attempt = await storage.getPublishAttempt(attemptId);
  if (!attempt || attempt.publisher !== principal) {
    return { ok: false, status: 404, code: 'NOT_FOUND', reason: 'no such published item of yours' };
  }
  if (attempt.status !== 'done' || !attempt.externalRef) {
    return { ok: false, status: 400, code: 'NOT_PUBLISHED', reason: 'that item was never published, so nobody could answer it' };
  }
  const connection = await storage.getConnection(attempt.connectionId);
  if (!connection || connection.principal !== principal) {
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
