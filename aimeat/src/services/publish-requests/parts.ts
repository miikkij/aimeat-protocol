/**
 * @file src/services/publish-requests/parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A request filed as PART of another (secaudit 2026-10, ai-image public picture past the
 *   publish gate; the developer's one-press decision, 2026-10-21). A gated public image job files two
 *   requests: one for the answer's record, one for the picture the record names. The picture's request
 *   carries `part_of` (the record request's id) and the record's carries `parts`, so the owner sees ONE
 *   item and ONE notification, and one press decides both (decide.ts, store.ts settlePublishRequest).
 *
 *   The part has no list item and no notification of its own. The parent's were made when the parent
 *   was filed, before the part existed, so they are rewritten here to name the part: the item's title,
 *   and the notification's title and its i18n key `publish_request_with_part`. A request without a link
 *   is untouched by everything here.
 * @structure PART_NOTIF_KEY · partTitle · announcePart(ctx, ownerGhii, parent, part)
 * @usage await announcePart(ctx, ownerGhii, parent, part); // after both are stored
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial: the picture of a gated public image job is a part of its record's request.
 */
import type { Storage } from '../../storage/interface.js';
import { patchItem } from '../open-items.js';
import { NOTIF_PREFIX } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';

/** The notification text of a request that has a part (locales: notiftext.publish_request_with_part.*). */
export const PART_NOTIF_KEY = 'publish_request_with_part';

/** What this file reads of a request (store.ts PublishRequest); its own shape, so store.ts imports this file and not the reverse. */
interface RequestNames { id: string; item_id: string | null; title: string; name: string }

/** The English line a person reads for a request and its part, on the list item and the notification. */
export function partTitle(who: string, parent: Pick<RequestNames, 'title'>, part: Pick<RequestNames, 'name'>): string {
  return `${who} asks to make ${parent.title} and its picture ${part.name} public`;
}

/**
 * Rewrite the parent's list item and notification so they name the part. Best-effort: the link itself
 * is already stored, and a failure here leaves the parent's own words, which still decide both.
 */
export async function announcePart(
  ctx: { storage: Storage }, ownerGhii: string, who: string, parent: RequestNames, part: RequestNames,
): Promise<void> {
  const title = partTitle(who, parent, part).slice(0, 200);
  try {
    if (parent.item_id) await patchItem(ctx.storage, ownerGhii, parent.item_id, { title });
    const door = `/v1/publish-requests/${parent.id}/decision`;
    const rows = await ctx.storage.listMemory(ownerGhii, { prefix: NOTIF_PREFIX });
    for (const row of rows) {
      const v = row.value as { type?: unknown; actions?: Array<{ endpoint?: unknown }> } | null;
      if (!v || v.type !== 'publish_request' || !(v.actions ?? []).some(a => a.endpoint === door)) continue;
      const next = {
        ...row,
        value: {
          ...(row.value as Record<string, unknown>),
          title,
          body: 'Public means anyone can read them, also people who are not signed in. If you approve, both are public at once. If you decline, both stay as they are.',
          i18n: { key: PART_NOTIF_KEY, vars: { who, what: parent.name, part: part.name } },
        },
        version: row.version + 1,
        updatedAt: new Date().toISOString(),
      };
      // On the version listed: a read mark written in between wins, and the parent keeps its own words.
      if (ctx.storage.setMemoryIfVersion) await ctx.storage.setMemoryIfVersion(next, row.version);
      else await ctx.storage.setMemory(next);
    }
    emitChange('notifications', ownerGhii);
    emitChange('open-items', ownerGhii);
  } catch (err) {
    logger.warn('Publish request: the parent request\'s item and notification could not name its part', {
      owner: ownerGhii, parent: parent.id, part: part.id, error: String(err),
    });
  }
}
