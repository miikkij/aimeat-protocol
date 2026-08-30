/**
 * @file notification-create.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A principal notifying its OWN owner: the one implementation behind
 *   POST /v1/notifications and the aimeat_notify MCP tool. Validates the four fields, names the
 *   sender (an app gets its name in front of the title and its own page as the default link, an
 *   agent its name, an owner session is the owner), and hands the record to notify(), which
 *   applies the owner's settings. Self-targeted only: the recipient is always the owner behind the
 *   caller's session; there is no surface for pushing at arbitrary owners.
 * @structure NotificationCreateError · createPrincipalNotification
 * @usage const r = await createPrincipalNotification(storage, config, req.auth!, body);
 * @version-history
 *   v1.0.0 — 2026-08-30 — Extracted from routes/notifications.ts so the MCP tool is the same call.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { notify } from './notify.js';
import type { NotifSource } from './notification-settings.js';
import { emitChange } from './event-bus.js';

export class NotificationCreateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'NotificationCreateError'; }
}

/** The slice of req.auth this needs. */
export interface CreatorAuth { owner: string; sub: string; roles: string[]; app_grant?: string | null }

export interface CreateNotificationInput { title?: unknown; body?: unknown; link?: unknown; type?: unknown; actions?: unknown }

export async function createPrincipalNotification(
  storage: Storage, config: AimeatConfig, auth: CreatorAuth, input: CreateNotificationInput,
): Promise<{ created: true; link: string | null; muted: boolean }> {
  const { title, body, link, type } = input;
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'title is required (string, max 200 chars)');
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > 10_000)) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'body must be a string (max 10000 chars)');
  }
  // Same-node paths only ('/...', not '//host' or absolute URLs) — a notification never deep-links off the node.
  if (link !== undefined && (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//') || link.length > 500)) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'link must be a same-node path starting with "/"');
  }
  if (type !== undefined && (typeof type !== 'string' || !/^[a-z0-9_:.-]{1,64}$/i.test(type))) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'type must match [a-z0-9_:.-]{1,64}');
  }
  // SECURITY: inline reply/api actions execute with the RECIPIENT's authority when clicked, so they
  // may only originate from trusted server-side emit code, never a principal posting here.
  if (input.actions !== undefined) {
    throw new NotificationCreateError(400, 'VALIDATION_ERROR', 'actions are set by the node, not by the notification creator; use link for navigation');
  }

  let finalTitle = title.trim();
  let finalLink = link as string | undefined;
  let finalType = type as string | undefined;
  let source: NotifSource;
  if (auth.roles.includes('app')) {
    const grant = auth.app_grant ? await storage.getAppGrant(auth.app_grant) : null;
    if (!finalLink && grant?.app) {
      const [appOwner, filename] = grant.app.split('/');
      finalLink = `/v1/apps/${encodeURIComponent(appOwner)}/${encodeURIComponent(filename)}?mode=inline`;
    }
    const appName = grant?.appName || 'App';
    finalTitle = `${appName}: ${finalTitle}`;
    finalType = finalType ?? 'app';
    source = { kind: 'app', name: appName, id: grant?.app || undefined };
  } else if (auth.roles.includes('agent') && !auth.roles.includes('owner')) {
    const agentName = auth.sub.includes('#') ? auth.sub.split('#')[0] : auth.sub;
    finalTitle = `${agentName}: ${finalTitle}`;
    finalLink = finalLink ?? '/v1/profile?tab=agents';
    finalType = finalType ?? 'agent';
    source = { kind: 'agent', name: agentName, id: auth.sub };
  } else {
    finalType = finalType ?? 'custom';
    source = { kind: 'owner', name: auth.owner };
  }

  const ghii = `${auth.owner}@${config.nodeId}`;
  const result = await notify(storage, ghii, { type: finalType, title: finalTitle, body: body as string | undefined, link: finalLink, source });
  emitChange('notifications', ghii);
  return { created: true, link: finalLink ?? null, muted: result.muted };
}
