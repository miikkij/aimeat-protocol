/**
 * @file src/services/realtime-yjs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a realtime room keeps of the Yjs documents its peers sync, and the shutdown
 *   write of it. A room keeps the latest update of each document so that a peer who joins later can
 *   ask for it (`requestState`). Peers name the documents, so the room keeps at most
 *   realtime.max_docs_per_room of them: a document past the limit is still relayed to the room, only
 *   its state is not kept, and its sender is told why. An anonymous echat room keeps none (the echat
 *   page never syncs a document, and its visitors have no account). At shutdown each kept document
 *   is filed under the room's creator as before, so at most that many per room, and none for an
 *   echat room, whose creator is not an account (secaudit2026oct26, yjsSnapshots:unbounded and
 *   saveAllYjsSnapshots:peer-docid-written-into-creator-namespace).
 * @structure ECHAT_ANONYMOUS_CREATOR · keepYjsSnapshot(room, docId, update, maxDocs) ·
 *   saveYjsSnapshots(storage, rooms)
 * @usage
 *   if (!keepYjsSnapshot(room, msg.docId, msg.update, config.realtimeMaxDocsPerRoom)) sendError(...);
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26). saveYjsSnapshots moved from realtime-manager.ts
 *     saveAllYjsSnapshots, with the echat room left out.
 */
import type { Storage } from '../storage/interface.js';
import type { RealtimeRoom } from './realtime-types.js';
import { logger } from '../utils/logger.js';
import { errorFields } from '../utils/error-fields.js';

/** The creator an anonymous echat room is made under (index-start.ts, the echat upgrade). */
export const ECHAT_ANONYMOUS_CREATOR = 'echat-anonymous';

/**
 * Keep `update` as the latest state of `docId` in `room`. False when the room already keeps
 * `maxDocs` other documents (0 is no limit); an anonymous echat room keeps nothing and answers true,
 * because there is nothing its sender should be told.
 */
export function keepYjsSnapshot(room: RealtimeRoom, docId: string, update: string, maxDocs: number): boolean {
  if (room.createdBy === ECHAT_ANONYMOUS_CREATOR) return true;
  if (maxDocs > 0 && !room.yjsSnapshots.has(docId) && room.yjsSnapshots.size >= maxDocs) return false;
  room.yjsSnapshots.set(docId, update);
  return true;
}

/** File each room's kept documents under its creator, 7 days, as the shutdown write always did. */
export async function saveYjsSnapshots(storage: Storage, rooms: Iterable<RealtimeRoom>): Promise<void> {
  for (const room of rooms) {
    if (room.createdBy === ECHAT_ANONYMOUS_CREATOR) continue;
    for (const [docId, snapshot] of room.yjsSnapshots) {
      const key = `realtime.yjs.${room.id}.${docId}`;
      const now = new Date().toISOString();
      await storage.setMemory({
        key,
        ownerGaii: room.createdBy,
        value: snapshot,
        visibility: 'private',
        tags: ['realtime', 'yjs-snapshot'],
        ttlHours: 168, // 7 days
        version: 1,
        createdAt: now,
        updatedAt: now,
      }).catch(err => {
        logger.warn('Failed to persist Yjs snapshot', { roomId: room.id, docId, ...errorFields(err) });
      });
    }
  }
}
