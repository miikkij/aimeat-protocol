/**
 * @file notify.ts
 * @description In-app notification inbox — server-side creation of notification records. A
 *   notification is a small memory record stored under the RECIPIENT's identity (so they read it
 *   via the owner-scoped memory path / the /v1/notifications route). Events (e.g. a workspace
 *   access request, an approval) call `notify()` to drop a message in someone's inbox; the
 *   recipient's header bell shows the unread count and lists them. Auto-expire after 90 days.
 * @structure notify(storage, recipientGhii, { type, title, body?, link? })
 * @usage import { notify } from '../services/notify.js';
 *   await notify(storage, `${creatorOwner}@${nodeId}`, { type: 'workspace_access_request', title, link });
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: memory-backed notification inbox.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

export const NOTIF_PREFIX = 'notif.';
const NOTIF_TTL_HOURS = 24 * 90;   // 90 days

export interface NotifyInput {
  /** Machine type, e.g. 'workspace_access_request' | 'workspace_access_approved'. */
  type: string;
  /** Short human-readable title shown in the bell. */
  title: string;
  /** Optional longer body / context. */
  body?: string;
  /** Optional in-app link the notification deep-links to (e.g. '/v1/profile#organisms'). */
  link?: string;
}

/**
 * Drop a notification into a recipient's inbox. `recipientGhii` is the owner GHII (owner@node).
 * Best-effort: never throws into the caller — a notification failure must not fail the action that
 * triggered it.
 */
export async function notify(storage: Storage, recipientGhii: string, input: NotifyInput): Promise<void> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    // Key sorts lexically by time; the route sorts newest-first explicitly anyway.
    await storage.setMemory({
      key: `${NOTIF_PREFIX}${now}.${id.slice(0, 8)}`,
      ownerGaii: recipientGhii,
      value: { id, type: input.type, title: input.title, body: input.body ?? '', link: input.link ?? '', read: false, createdAt: now },
      visibility: 'private',
      tags: ['notif'],
      ttlHours: NOTIF_TTL_HOURS,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    /* notifications are best-effort — swallow so the triggering action still succeeds */
  }
}
