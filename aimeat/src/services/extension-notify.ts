/**
 * @file src/services/extension-notify.ts
 * @description Cross-owner extension notification, consent-gated: `ctx.notify(message, { to })`
 *   reaches ANOTHER owner's bell + web push only when that owner holds an active consent grant
 *   `purpose: 'extension_notify'` whose data_pattern names this extension (`ext:{name}`) —
 *   the exact tiering precedent ctx.email set with `extension_email`. Without the grant the call
 *   returns false and the target never hears about it (an extension must not become a spam
 *   cannon). The notification lands in the TARGET's private notifications list and the notify()
 *   push path, attributed to the extension.
 * @structure safeNotificationLink, extensionCrossNotify
 * @usage if (opts?.to) return extensionCrossNotify(storage, config, ext.name, opts.to, message, opts);
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial (TINKI watch push; generic for every extension)
 *   v1.1.0 — 2026-08-06 — opts.link: the extension names where the notification leads, restricted
 *     to this node and its own app origins.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/**
 * Where an extension's notification may lead. A notification is a message the node delivers in its
 * own name, so an extension-supplied destination is a phishing vector unless it is fenced: a
 * relative path on this node, or an absolute URL on one of this node's own app origins
 * (`<app>.apps.<apex>`) — which is where a published app actually lives, and therefore the only
 * way a deep link into an app can work at all. Anything else falls back to the default.
 */
export function safeNotificationLink(config: AimeatConfig, link: unknown, fallback: string): string {
  if (typeof link !== 'string' || !link) return fallback;
  // Relative path on this node. Reject protocol-relative "//host" — that leaves the node.
  if (link.startsWith('/') && !link.startsWith('//')) return link.slice(0, 500);
  let url: URL;
  try { url = new URL(link); } catch { return fallback; }  // unparseable IS the "not allowed" answer
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
  const host = url.hostname.toLowerCase();
  const appHost = (config.appHost || '').toLowerCase();
  const nodeHost = (() => {
    // eslint-disable-next-line aimeat/no-silent-catch -- same: a bad baseUrl means "no host to match"
    try { return new URL(config.baseUrl).hostname.toLowerCase(); } catch { return ''; }
  })();
  const onAppOrigin = !!appHost && (host === appHost || host.endsWith(`.${appHost}`));
  const onNode = !!nodeHost && host === nodeHost;
  return onAppOrigin || onNode ? link.slice(0, 500) : fallback;
}

/**
 * Notify a DIFFERENT owner from an extension, if and only if they consented to hear from it.
 * `to` accepts a bare owner name or a full GHII on this node. Returns whether it was delivered.
 */
export async function extensionCrossNotify(
  storage: Storage,
  config: AimeatConfig,
  extName: string,
  to: string,
  message: string,
  opts?: { title?: string; priority?: string; channel?: string; link?: string },
): Promise<boolean> {
  const targetOwner = String(to).split('@')[0];
  if (!targetOwner) return false;
  const targetGhii = `${targetOwner}@${config.nodeId}`;
  const ghii = await storage.getGHII(targetGhii);
  if (!ghii) {
    logger.warn(`[ext:${extName}] cross-notify blocked: no such owner ${targetOwner}`);
    return false;
  }
  const consents = await storage.listConsents(targetGhii, { status: 'active' });
  const allowed = consents.some((c) => c.purpose === 'extension_notify' && c.dataPattern === `ext:${extName}`);
  if (!allowed) {
    logger.warn(`[ext:${extName}] cross-notify blocked: ${targetOwner} has no extension_notify consent for ext:${extName}`);
    return false;
  }
  const key = `notifications.${targetOwner}`;
  const existing = await storage.getMemory(targetGhii, key);
  const list = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
  list.push({
    id: randomUUID(),
    message,
    title: opts?.title || extName,
    priority: opts?.priority || 'normal',
    channel: opts?.channel || 'extension',
    source: extName,
    read: false,
    createdAt: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: targetGhii, value: list.slice(-100), visibility: 'private',
    tags: ['notifications'], ttlHours: null,
    version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now,
  });
  void notify(storage, targetGhii, {
    type: 'extension', title: opts?.title || extName, body: message,
    link: safeNotificationLink(config, opts?.link, '/v1/profile?tab=extensions'),
  });
  return true;
}
