/**
 * @file mailbox/attachment-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a stored file is an attachment of the mailbox a reader may read in the owner's
 *   name. A received direct-message attachment is copied into the recipient's own storage as a
 *   `private` file under `dm/<conversation>/<message>/<attachment>` (attachment-duplication.ts). An
 *   agent holding messages:read-as-owner reads that message, and the thread hands it the file's
 *   reference, but the file read went through authorizeRead alone. That guard keeps an agent out of its
 *   owner's private files on purpose, so the read answered `no_matching_consent`, and the agent could
 *   read every message and open none of their attachments.
 *
 *   The attachment is part of the message. The delegation that reads the message reads its attachment,
 *   and nothing next to it: the file must be the recorded local copy of an attachment on a message that
 *   sits in the reader's own owner's mailbox. Any other private file of the owner stays behind the
 *   ordinary visibility and consent checks.
 * @structure mailboxAttachmentReadable · parseMailboxAttachmentKey
 * @usage
 *   const reader = mailboxReaderOf(req.auth!, config.nodeId);
 *   if (reader && await mailboxAttachmentReadable(storage, reader, ownerGaii, key)) → allowed
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial: GET /v1/pub and aimeat_storage_download serve a mailbox attachment
 *     to a reader of that mailbox.
 */
import type { Storage } from '../../storage/interface.js';
import type { MailboxReader } from '../owner-mailbox-reads.js';
import { logger } from '../../utils/logger.js';

/** `dm/<conversation>/<message>/<attachment>`, the key attachment-duplication.ts writes a received copy under. */
export function parseMailboxAttachmentKey(key: string): { conversationId: string; messageId: string; attachmentId: string } | null {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'dm' || parts.slice(1).some(p => !p)) return null;
  return { conversationId: parts[1]!, messageId: parts[2]!, attachmentId: parts[3]! };
}

/**
 * True when `key` under `fileOwnerGaii` is the stored copy of an attachment on a message in the
 * mailbox `reader` reads. The file owner must be the mailbox itself (the owner's GHII), the message
 * must be in that mailbox, and the message must record this key as that attachment's local copy, so
 * a file merely placed under a `dm/` key is not reached. Never throws.
 */
export async function mailboxAttachmentReadable(
  storage: Storage,
  reader: MailboxReader,
  fileOwnerGaii: string,
  key: string,
): Promise<boolean> {
  if (fileOwnerGaii !== reader.ownerGhii) return false;
  const parsed = parseMailboxAttachmentKey(key);
  if (!parsed) return false;
  try {
    const message = await storage.getDirectMessage(parsed.messageId, reader.ownerGhii);
    if (!message || message.conversationId !== parsed.conversationId) return false;
    const att = (message.attachments ?? []).find(a => a.id === parsed.attachmentId);
    if (!att || att.mode !== 'duplicate' || att.localKey !== key || att.expired) return false;
    // A delegated read leaves no trace in the mailbox, so the log line is the record of which agent
    // opened which attachment (the same record owner-mailbox-reads.ts keeps for the messages).
    if (reader.kind === 'delegate') {
      logger.info('mailbox read as owner (delegated)', { agent: reader.actor, owner: reader.ownerGhii, what: 'attachment', key });
    }
    return true;
  } catch (err) {
    logger.warn('mailboxAttachmentReadable: refused after a lookup failure', { error: String(err), key });
    return false;
  }
}
