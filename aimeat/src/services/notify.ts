/**
 * @file notify.ts
 * @description In-app notification inbox — server-side creation of notification records. A
 *   notification is a small memory record stored under the RECIPIENT's identity (so they read it
 *   via the owner-scoped memory path / the /v1/notifications route). Events (e.g. a workspace
 *   access request, an approval) call `notify()` to drop a message in someone's inbox; the
 *   recipient's header bell shows the unread count and lists them. Auto-expire after 90 days.
 *   When the recipient has a web-push subscription, the same notification is also delivered as a
 *   browser push (best-effort) whose click deep-links to the same target as the bell entry.
 * @structure
 *   - notify(storage, recipientGhii, { type, title, body?, link? })
 *   - setNotifyPushService(push) — wired once at boot so notify() can bridge to web push
 *   - notifLinkToUrl(link) — bell link vocabulary ('/v1/profile#inbox/<id>') → openable URL
 * @usage import { notify } from '../services/notify.js';
 *   await notify(storage, `${creatorOwner}@${nodeId}`, { type: 'workspace_access_request', title, link });
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: memory-backed notification inbox.
 *   v1.1.0 -- 2026-07-02 -- Bridge bell notifications to web push with deep-link URL translation.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { PushService } from './push.js';

export const NOTIF_PREFIX = 'notif.';
const NOTIF_TTL_HOURS = 24 * 90;   // 90 days

/** Wired once at boot (routes-loader) so every notify() call can also fire a web push. */
let pushService: PushService | null = null;
export function setNotifyPushService(push: PushService | null): void {
  pushService = push;
}

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
 * Translate a bell-vocabulary link into a URL that opens correctly from a cold start (push
 * notification click, new window). The bell's '/v1/profile#<tab>[/<rest>]' hash form only works
 * through the SPA's client-side translation, so it becomes '?tab=' (which profile.js reads on
 * mount) while keeping the hash so an open SPA can still resolve the thread/detail part.
 */
export function notifLinkToUrl(link?: string): string {
  if (!link) return '/v1/profile';
  const m = /^\/v1\/profile#([a-z]+)(?:\/(.+))?$/i.exec(link);
  if (!m) return link;
  const tabId = m[1].toLowerCase() === 'inbox' ? 'messages' : m[1];
  return `/v1/profile?tab=${encodeURIComponent(tabId)}#${m[1]}${m[2] ? `/${m[2]}` : ''}`;
}

/**
 * Drop a notification into a recipient's inbox. `recipientGhii` is the owner GHII (owner@node).
 * Best-effort: never throws into the caller — a notification failure must not fail the action that
 * triggered it. Also mirrors the notification to the recipient's web-push subscription (if any);
 * the push click opens the same deep link as the bell entry.
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
    if (pushService?.enabled) {
      // Same tag per type ⇒ a newer notification of the same kind replaces the shown one instead
      // of stacking. A recipient without a push subscription is a silent no-op inside the service.
      void pushService.sendNotification(recipientGhii.split('@')[0], {
        title: input.title,
        body: input.body ?? '',
        url: notifLinkToUrl(input.link),
        tag: `notif:${input.type}`,
      }).catch(() => { /* push is best-effort */ });
    }
  } catch {
    /* notifications are best-effort — swallow so the triggering action still succeeds */
  }
}
