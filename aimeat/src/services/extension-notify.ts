/**
 * @file src/services/extension-notify.ts
 * @description Cross-owner extension notification, consent-gated: `ctx.notify(message, { to })`
 *   reaches ANOTHER owner's bell + web push only when that owner holds an active consent grant
 *   `purpose: 'extension_notify'` whose data_pattern names this extension (`ext:{name}`) —
 *   the exact tiering precedent ctx.email set with `extension_email`. Without the grant the call
 *   returns false and the target never hears about it (an extension must not become a spam
 *   cannon). The notification lands in the TARGET's private notifications list and the notify()
 *   push path, attributed to the extension.
 * @structure extensionCrossNotify
 * @usage if (opts?.to) return extensionCrossNotify(storage, config, ext.name, opts.to, message, opts);
 * @version-history
 *   v1.0.0 — 2026-08-06 — Initial (TINKI watch push; generic for every extension)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

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
  opts?: { title?: string; priority?: string; channel?: string },
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
    type: 'extension', title: opts?.title || extName, body: message, link: '/v1/profile?tab=extensions',
  });
  return true;
}
