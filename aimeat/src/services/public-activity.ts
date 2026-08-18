/**
 * @file public-activity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Records public, landing-page-visible activity events (app publishes,
 *   public organism / workspace publishes, agent materials & knowledge packages).
 *   Each event is persisted as a PUBLIC memory entry under the reserved system
 *   identity `system@{nodeId}` (mirrors services/ecosystem-events.ts — no new DB
 *   table, so no dual-backend schema work) and then broadcast on the event-bus
 *   `publicActivity` channel so the public SSE stream (routes/public-events.ts)
 *   pushes it live. Self-prunes the log (the core memory-ttl-cleanup job only
 *   prunes agent-owned memory, never system@). Privacy: callers MUST emit only
 *   when the underlying thing is genuinely public; `detail` carries already-public
 *   fields only (never raw memory values); `actor` is reduced to its name segment.
 * @structure recordPublicActivity() + readPublicActivity() helper for the REST feed.
 * @usage import { recordPublicActivity } from '../services/public-activity.js';
 *   void recordPublicActivity(storage, config, { category, actor, summary, detail, link })
 *     .catch(err => logger.error('recordPublicActivity failed', { error: String(err) }));
 * @version-history
 *   v1.0.0 — 2026-06-16 — Initial: public landing activity feed (events + SSE).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { emitPublicActivity } from './event-bus.js';
import type { PublicActivityEvent } from './event-bus.js';
import { logger } from '../utils/logger.js';

export type PublicActivityCategory = PublicActivityEvent['category'];

const KEY_PREFIX = 'activity/';
const MAX_KEEP = 300;                       // hard cap on retained events
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;   // 30 days
const TTL_HOURS = 30 * 24;                  // honest metadata (system@ isn't TTL-swept)

const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;

/** Reduce a GAII/GHII to its display name segment — never leak a full private path. */
function nameSegment(identity: string): string {
  if (!identity) return '';
  return identity.includes('#') ? identity.split('#')[0] : identity.split('@')[0];
}

export interface RecordPublicActivityInput {
  category: PublicActivityCategory;
  /** Raw identity of the actor; reduced to its name segment before storage/broadcast. */
  actor: string;
  summary: string;
  detail: string;
  link: string;
}

/**
 * Persist one public activity event, then broadcast it. Best-effort and self-contained:
 * a failure here must never break the caller's primary response (callers fire-and-forget
 * with `.catch`). Persist BEFORE emit so a live SSE event always has a backing entry on
 * reload.
 */
export async function recordPublicActivity(
  storage: Storage,
  config: AimeatConfig,
  input: RecordPublicActivityInput,
): Promise<void> {
  const at = new Date().toISOString();
  const evt: PublicActivityEvent = {
    category: input.category,
    at,
    actor: nameSegment(input.actor),
    summary: input.summary,
    detail: input.detail,
    link: input.link,
  };

  const systemGhii = systemGhiiFor(config.nodeId);
  const key = `${KEY_PREFIX}${input.category}/${at}-${randomUUID().slice(0, 8)}`;
  await storage.setMemory({
    key,
    ownerGaii: systemGhii,
    value: evt,
    visibility: 'public',
    tags: ['public-activity', input.category],
    ttlHours: TTL_HOURS,
    version: 1,
    createdAt: at,
    updatedAt: at,
  });

  // Broadcast only after the write succeeds.
  emitPublicActivity(evt);

  // Best-effort prune — never block or fail the emit.
  void pruneOldActivity(storage, systemGhii).catch(err =>
    logger.error('pruneOldActivity failed', { error: String(err) }),
  );
}

/** Drop events older than MAX_AGE_MS or beyond MAX_KEEP newest. */
async function pruneOldActivity(storage: Storage, systemGhii: string): Promise<void> {
  const { items } = await storage.listAllMemory({
    prefix: KEY_PREFIX,
    ownerPrefix: systemGhii,
    visibility: 'public',
    limit: 1000,
  });
  const now = Date.now();
  const sorted = items
    .filter(m => m.key.startsWith(KEY_PREFIX))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const doomed = sorted.filter((m, i) =>
    i >= MAX_KEEP || (m.updatedAt && now - new Date(m.updatedAt).getTime() > MAX_AGE_MS),
  );
  for (const m of doomed) {
    await storage.deleteMemory(m.ownerGaii, m.key);
  }
}

/**
 * Read recent public activity for the REST feed. `category` filters to one tab;
 * omit it to read all categories. Returns newest-first event values.
 */
export async function readPublicActivity(
  storage: Storage,
  config: AimeatConfig,
  opts: { category?: PublicActivityCategory; limit?: number } = {},
): Promise<PublicActivityEvent[]> {
  const prefix = opts.category ? `${KEY_PREFIX}${opts.category}/` : KEY_PREFIX;
  const { items } = await storage.listAllMemory({
    prefix,
    ownerPrefix: systemGhiiFor(config.nodeId),
    visibility: 'public',
    limit: 500,
  });
  return items
    .filter(m => m.key.startsWith(prefix) && m.value && typeof m.value === 'object')
    .map(m => m.value as PublicActivityEvent)
    .filter(v => v && v.at && v.category)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.min(opts.limit ?? 50, 200));
}

/** Exposed so the existing public ticker/stats can exclude these synthetic entries. */
export const PUBLIC_ACTIVITY_KEY_PREFIX = KEY_PREFIX;
