/**
 * @file src/services/publish-requests/request-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a publish request's notice leads: the page that shows the thing the request is
 *   about, by kind. A kind without a page of its own leads to the notifications page, where the
 *   notice itself carries the buttons.
 * @structure publishRequestLink()
 * @usage link: publishRequestLink(request)
 * @version-history
 *   v1.0.0 — 2026-11-16 — Initial: an app and an internet opening lead to the App Catalog, an organism
 *     and a workspace share to the organism, a package to the Packages page, a skill to the Skills page.
 */
import { organismLink, openItemLink, packageLink } from '../notifications/links.js';
import type { PublishKind } from './kinds.js';

const NOTIFICATIONS = '/v1/profile?tab=notifications';

/** The page that shows what `request` is about, or the notifications page when the kind has none. */
export function publishRequestLink(request: { kind: PublishKind; target: Record<string, string | number> }): string {
  const field = (name: string): string => String(request.target?.[name] ?? '').trim();
  switch (request.kind) {
    case 'app':
    case 'internet-opening': {
      const owner = field('owner');
      const filename = field('filename');
      return owner && filename ? `/v1/appcat?app=${encodeURIComponent(`${owner}/${filename}`)}` : NOTIFICATIONS;
    }
    case 'organism': {
      const id = field('organism_id');
      return id ? organismLink(id) : NOTIFICATIONS;
    }
    case 'workspace-share': {
      const id = field('organism_id');
      return id ? organismLink(id, field('ws') || null) : NOTIFICATIONS;
    }
    case 'package': {
      const groupId = field('group_id');
      return groupId ? packageLink(groupId) : NOTIFICATIONS;
    }
    case 'skill': {
      // A user skill's target owner is the local account name (apply-skill.ts), so the ref needs no cut.
      const owner = field('owner');
      const name = field('name');
      return owner && name ? openItemLink('skills', `user:${owner}/${name}`) : NOTIFICATIONS;
    }
    default:
      return NOTIFICATIONS;
  }
}
