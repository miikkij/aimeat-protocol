/**
 * @file owner-mailbox-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The door on the four owner-mailbox reads (GET /v1/messages/inbox, /conversations,
 *   /conversations/:id, /overview). It admits the owner in person, a published app holding
 *   `messages:read`, and an agent holding `messages:read-as-owner`, and nobody else. Who those three
 *   are and what each is shown is decided in services/owner-mailbox-reads.ts; this file only turns
 *   that decision into a 403 a client can act on.
 *
 *   Why not requireRoleOrScope('owner', 'messages:read'): its scope path admits ANY principal
 *   carrying the word, and on an agent that word means the agent's own messages. The handlers read
 *   the owner's mailbox by the owner's name, so that gate would have handed every agent with the
 *   commonest messaging word its siblings' conversations. The organism doors left that helper on
 *   2026-08-14 for the same reason.
 * @structure requireOwnerMailboxRead(nodeId)
 * @usage router.get('/v1/messages/inbox', requireAuth(), requireOwnerMailboxRead(config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, replacing requireRole('owner') on the four mailbox reads.
 */
import type { Request, Response, NextFunction } from 'express';
import { deny401, deny403, denyScope403 } from './deny.js';
import { mailboxReaderOf, MESSAGES_READ_AS_OWNER_SCOPE } from '../services/owner-mailbox-reads.js';

export function requireOwnerMailboxRead(nodeId: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) { deny401(req, res, 'Authentication required'); return; }
    if (mailboxReaderOf(req.auth, nodeId)) { next(); return; }
    const roles = req.auth.roles ?? [];
    if (req.auth.federated) {
      deny403(req, res, 'ACCESS_DENIED', 'A session signed in from another node has no mailbox on this one.');
      return;
    }
    // Each refusal names the one word that would open this door for THIS kind of principal, so the
    // client asks its owner for that word rather than for everything.
    if (roles.includes('app')) {
      denyScope403(req, res, ['messages:read'], 'Scope "messages:read" required: the owner approves it for this app.');
      return;
    }
    if (roles.includes('agent') || roles.includes('ecosystem')) {
      denyScope403(req, res, [MESSAGES_READ_AS_OWNER_SCOPE],
        `Scope "${MESSAGES_READ_AS_OWNER_SCOPE}" required. messages:read reads this agent's own messages `
        + '(GET /v1/messages/agent-inbox); reading the owner\'s mailbox is a permission the owner grants on its own tick.');
      return;
    }
    deny403(req, res, 'ACCESS_DENIED', 'Role "owner" required');
  };
}
