/**
 * @file src/utils/own-door-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Memory records a generic memory door does not serve, because they have a door of their
 *   own, and what the generic door answers instead. Today one kind: a Design Book part.
 *
 *   ONE CAPABILITY, ONE DOOR. A Design Book part is a public memory record under the node's own system
 *   identity (services/design-book/service.ts), and the Design Book's doors are the one way to read it:
 *   GET /v1/designbook/:id and aimeat_designbook_get bench a component again and give the markup and
 *   the stylesheet of one that no longer passes only to its proposer. A generic memory door that reads
 *   another identity's public records would hand a part out past all of that: the public read and its
 *   tool, the copy into the caller's own memory, an extension's public read, the librarian's public
 *   search. Each of them asks here first, and answers with a refusal that names the Book's door, or
 *   leaves the part out of what it finds. The record's storage and visibility stay as they are.
 *
 *   A part is a part only under the node's own system identity: a record an owner keeps under the same
 *   key in their own namespace is theirs, and the generic doors serve it as any other. A key rule every
 *   door asks, like utils/reserved-keys.ts, so it sits beside that one.
 * @structure DESIGN_BOOK_PART_PREFIX · OwnDoorRefusal · ownDoorRefusal(ownerGaii, key, nodeId)
 * @usage const refusal = ownDoorRefusal(ownerGaii, key, config.nodeId); if (refusal) … refusal.code, refusal.message
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: a Design Book part.
 */
import { systemGhiiFor } from '../services/compliance-register.js';

/** Where a Design Book part is stored: `atelier.book.part.<id>`, under the node's own system identity. */
export const DESIGN_BOOK_PART_PREFIX = 'atelier.book.part.';

/** What a generic memory door answers for a record with a door of its own: its code, the sentence, and that door. */
export interface OwnDoorRefusal { code: 'DESIGN_BOOK_PART'; message: string; door: string }

/**
 * The refusal a generic memory door gives for a record with a door of its own, or null for every other
 * record. The two names are what the door was handed, so anything but two strings is no such record.
 */
export function ownDoorRefusal(ownerGaii: unknown, key: unknown, nodeId: string): OwnDoorRefusal | null {
  if (typeof ownerGaii !== 'string' || typeof key !== 'string') return null;
  if (ownerGaii !== systemGhiiFor(nodeId) || !key.startsWith(DESIGN_BOOK_PART_PREFIX)) return null;
  const id = key.slice(DESIGN_BOOK_PART_PREFIX.length);
  const door = `/v1/designbook/${encodeURIComponent(id)}`;
  return {
    code: 'DESIGN_BOOK_PART',
    message: `"${key}" is a Design Book part, and the Design Book is the one door that reads it: GET ${door}, or aimeat_designbook_get with id "${id}".`,
    door,
  };
}
