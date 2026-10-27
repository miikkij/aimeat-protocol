/**
 * @file src/routes/federation-sync/inbound-attachments.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The re-stamping of an inbound federated message's attachment descriptors, so the bytes
 *   can only be the sender's on the node that sent them. Extracted from messaging.ts (max-file-lines).
 * @structure normalizeInboundAttachments
 * @usage const attachments = normalizeInboundAttachments(body.attachments, senderGhii, sourceNode);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Extracted from routes/federation-sync/messaging.ts (max-file-lines), unchanged.
 */
import type { DirectMessageAttachment } from '../../storage/interface.js';

/**
 * An inbound attachment descriptor says which storage the bytes come from, so those two fields are
 * the peer's claim about somebody else's disk and are re-stamped rather than believed: the bytes
 * can only be the SENDER's, on the node that sent them. mapMessageAttachments() does the identical
 * thing to a client's claim on the way out, for the same reason.
 *
 * Believing them let a peer set originNodeId to THIS node and ownerGhii to a local owner, which
 * sends the duplicator down its same-node branch (services/attachment-duplication.ts:45) to read
 * that owner's private file and write the bytes into the recipient's own storage.
 */
export function normalizeInboundAttachments(
    attachments: DirectMessageAttachment[] | undefined | null,
    senderGhii: string,
    sourceNode: string,
): DirectMessageAttachment[] | undefined {
    if (!attachments?.length) return undefined;
    return attachments.map(a => ({ ...a, ownerGhii: senderGhii, originNodeId: sourceNode }));
}
