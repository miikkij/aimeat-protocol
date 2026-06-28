/**
 * @file secretary-feed.ts
 * @description The owner's Secretary activity feed (`secretary.feed` memory key) — a capped, newest-first
 *   list of what the Secretary did/surfaced (briefings, filed notes, reviews, clarify outcomes). Extracted
 *   from scheduler.ts so both the autonomous tick AND the live DM responder / clarify-produce path append
 *   to the SAME feed through one helper (single source of truth for the record shape + cap).
 * @structure SecretaryFeedEntry · appendSecretaryFeed()
 * @usage import { appendSecretaryFeed } from './secretary-feed.js';
 * @version-history
 *   v1.0.0 — 2026-06-28 — Extracted from scheduler.appendFeed so the clarify-produce + live responder reuse it.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

export interface SecretaryFeedEntry {
  kind: string;
  contextId: string;
  contextName: string;
  text: string;
  href?: string;
}

/** Max feed items kept (newest-first); older entries are dropped. */
const FEED_CAP = 50;

/** Prepend an entry to the owner's `secretary.feed` (capped, newest-first). */
export async function appendSecretaryFeed(storage: Storage, owner: string, entry: SecretaryFeedEntry): Promise<void> {
  const feedKey = 'secretary.feed';
  const existing = await storage.getMemory(owner, feedKey);
  const list = Array.isArray((existing?.value as { items?: unknown[] } | undefined)?.items)
    ? (existing!.value as { items: unknown[] }).items : [];
  const now = new Date().toISOString();
  const items = [{ id: randomUUID(), ts: now, ...entry }, ...list].slice(0, FEED_CAP);
  await storage.setMemory({
    key: feedKey, ownerGaii: owner, value: { items }, visibility: 'private', tags: ['secretary', 'feed'],
    ttlHours: null, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}
