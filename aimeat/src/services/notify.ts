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
 *   - notify(storage, recipientGhii, { type, title, body?, link?, actions? })
 *   - dismissConversationNotifications(storage, recipientGhii, conversationId) — delete the bell
 *     notifications deep-linking to a conversation once its owner has read that thread
 *   - setNotifyPushService(push) — wired once at boot so notify() can bridge to web push
 *   - notifLinkToUrl(link) — bell link vocabulary ('/v1/profile#inbox/<id>') → openable URL
 *   - NotifAction — an inline action a notification carries (reply | api | navigate), rendered as a
 *     button in the header bell. SECURITY: 'reply'/'api' actions execute with the RECIPIENT's own
 *     authority when they click, so they may ONLY be set by trusted server-side emit code — never
 *     derived from a principal's input. The public POST /v1/notifications route rejects them.
 *   - isSafeNotifActionEndpoint(path) — same-node-path guard shared with the route.
 * @usage import { notify } from '../services/notify.js';
 *   await notify(storage, `${creatorOwner}@${nodeId}`, { type: 'workspace_access_request', title, link });
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: memory-backed notification inbox.
 *   v1.1.0 -- 2026-07-02 -- Bridge bell notifications to web push with deep-link URL translation.
 *   v1.2.0 -- 2026-07-18 -- Inline notification actions (reply/api/navigate); mirror up to two into
 *     the web-push payload so the SW can offer OS-level action buttons.
 *   v1.3.0 -- 2026-07-21 -- dismissConversationNotifications(): reading a DM thread deletes its bell
 *     notifications (delivered #inbox/<id> + request #inbox/req:<id> links) so a seen message stops
 *     lingering in the header bell. Called from POST /v1/messages/conversations/:id/read.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { PushService } from './push.js';

export const NOTIF_PREFIX = 'notif.';
const NOTIF_TTL_HOURS = 24 * 90;   // 90 days
/** How many actions a single notification may carry (bell + web-push button budget). */
export const MAX_NOTIF_ACTIONS = 3;

/** Visual weight of an action button in the bell (maps to existing btn-* classes). */
export type NotifActionStyle = 'primary' | 'default' | 'danger';

/**
 * An inline action a notification offers. Three kinds:
 *   - 'navigate': deep-link somewhere in the SPA (link-equivalent, carries no new authority).
 *   - 'reply':    open an inline text box in the bell and POST /v1/messages to `to` (DM reply).
 *   - 'api':      call a same-node endpoint (approve/deny/accept/decline) with the clicker's JWT.
 * `id` is a stable slug ('reply' | 'approve' | 'deny' | 'accept' | 'decline' | 'reject' | ...) the
 * frontend uses to localize the button label; `label` is the English fallback.
 */
export type NotifAction =
  | { id: string; label: string; kind: 'navigate'; link: string; style?: NotifActionStyle }
  | { id: string; label: string; kind: 'reply'; to: string; conversationId?: string; subject?: string; replyTo?: string; style?: NotifActionStyle }
  | { id: string; label: string; kind: 'api'; method: 'POST' | 'PATCH' | 'DELETE'; endpoint: string; body?: Record<string, unknown>; confirm?: boolean; style?: NotifActionStyle };

/** Same-node path guard for an action endpoint/link ('/...' only — never '//host' or a full URL). */
export function isSafeNotifActionEndpoint(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && path.length <= 500;
}

/** Wired once at boot (routes-loader) so every notify() call can also fire a web push. */
let pushService: PushService | null = null;
export function setNotifyPushService(push: PushService | null): void {
  pushService = push;
}

/**
 * Delete the recipient's bell notifications that deep-link to a given conversation — called when they
 * open/read that thread, so a message they've now seen stops nagging from the header bell. Matches both
 * the delivered-message link (#inbox/<id>) and the "wants to message you" request link (#inbox/req:<id>).
 * Best-effort: never throws into the caller. Returns the number removed (0 if none / on any error).
 */
export async function dismissConversationNotifications(storage: Storage, recipientGhii: string, conversationId: string): Promise<number> {
  if (!conversationId) return 0;
  try {
    const links = new Set([`/v1/profile#inbox/${conversationId}`, `/v1/profile#inbox/req:${conversationId}`]);
    const mine = await storage.listMemory(recipientGhii, { prefix: NOTIF_PREFIX });
    const refs = mine
      .filter(r => { const v = r.value as { link?: string } | null; return !!v && typeof v.link === 'string' && links.has(v.link); })
      .map(r => ({ ownerGaii: recipientGhii, key: r.key }));
    if (!refs.length) return 0;
    if (storage.bulkDeleteMemory) return await storage.bulkDeleteMemory(refs);
    let removed = 0;
    for (const ref of refs) { if (await storage.deleteMemory(ref.ownerGaii, ref.key)) removed++; }
    return removed;
  } catch {
    return 0;
  }
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
  /**
   * Optional inline actions (reply / api / navigate) rendered as buttons in the bell. Trusted-only:
   * only server-side emit code sets these — see the SECURITY note in the file header. Capped at
   * MAX_NOTIF_ACTIONS; anything beyond is dropped.
   */
  actions?: NotifAction[];
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
    const actions = Array.isArray(input.actions) ? input.actions.slice(0, MAX_NOTIF_ACTIONS) : [];
    // Key sorts lexically by time; the route sorts newest-first explicitly anyway.
    await storage.setMemory({
      key: `${NOTIF_PREFIX}${now}.${id.slice(0, 8)}`,
      ownerGaii: recipientGhii,
      value: { id, type: input.type, title: input.title, body: input.body ?? '', link: input.link ?? '', actions, read: false, createdAt: now },
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
      // Mirror up to two actions into the OS-level push (Notification.actions caps low, and a lock
      // screen can't take free text) — the SW turns a button click into a focus + postMessage so the
      // open SPA runs it with the owner's session; data.actions carries the full descriptors.
      void pushService.sendNotification(recipientGhii.split('@')[0], {
        title: input.title,
        body: input.body ?? '',
        url: notifLinkToUrl(input.link),
        tag: `notif:${input.type}`,
        actions: actions.slice(0, 2).map(a => ({ action: a.id, title: a.label })),
        data: { notifId: id, actions },
      }).catch(() => { /* push is best-effort */ });
    }
  } catch {
    /* notifications are best-effort — swallow so the triggering action still succeeds */
  }
}
