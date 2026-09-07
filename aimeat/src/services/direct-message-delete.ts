/**
 * @file direct-message-delete.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removing one message from an owner's mailbox — the one implementation, for the
 *   REST door and the MCP tools alike.
 *
 *   Two lines of work and a third thing that must not be got wrong twice: WHOSE mailbox. The
 *   answer is always the acting principal's own owner, derived from the session and never from
 *   anything the caller sent. An agent's resolved identity is its GAII, and the owner's messages
 *   are not in that mailbox, so a surface that reached for the agent identity here would answer
 *   NOT_FOUND for a message sitting in plain sight on the owner's page — the shape of defect that
 *   has already been fixed three separate times inside one MCP tool, each time on one surface
 *   while the other kept the old behaviour.
 * @structure ownerMailbox(auth, nodeId) · deleteOwnerMessage(storage, auth, nodeId, id)
 * @usage
 *   const gone = await deleteOwnerMessage(storage, req.auth!, config.nodeId, id);
 *   if (!gone) return res.status(404)…
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial, with the delete-as-owner door.
 */
import type { Storage } from '../storage/interface.js';
import { emitChange } from './event-bus.js';

/** What the principal's session says about identity. The two fields this needs, and nothing else. */
export interface ActingPrincipal {
  /** The account this principal acts for. Present on every principal type: owner, agent, app, GEAI. */
  owner: string;
}

/**
 * The mailbox a principal acts on: its OWN owner's, always.
 *
 * `req.auth!.owner` carries the human's name on an owner session, an agent JWT, an app grant and an
 * ecosystem token alike, so this is the same GHII in every case — which is the point. It is NOT a
 * permission test: `owner` names the account, never the principal, and comparing it decides nothing
 * about who is allowed to act (security-development-dna invariant 11). The gate is the scope on the
 * door; this only says where the door leads.
 */
export function ownerMailbox(auth: ActingPrincipal, nodeId: string): string {
  return `${auth.owner}@${nodeId}`;
}

/**
 * Remove the owner's copy of one message. True when a message was there and is now gone.
 *
 * The `messages` change is emitted here rather than by each caller, so a surface cannot delete a
 * message and leave every open page still showing it.
 */
export async function deleteOwnerMessage(
  storage: Storage,
  auth: ActingPrincipal,
  nodeId: string,
  id: string,
): Promise<boolean> {
  const gone = await storage.deleteDirectMessage(id, ownerMailbox(auth, nodeId));
  if (gone) emitChange('messages');
  return gone;
}
