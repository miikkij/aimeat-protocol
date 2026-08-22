-- Has the mailbox's OWNER looked at this row?
--
-- `readAt` could not answer that, and the difference is what let four agent reports pass their owner
-- unseen. A group thread writes an agent's sent copy into its OWNER's mailbox, and `setMessageReadReceipt`
-- stamps `readAt` on that outbound copy when the RECIPIENT reads it. So an unread count keyed on
-- `readAt` would have been cleared by the operator reading the message, and clearing it from the
-- owner's side would have written `status = 'read'` on a row where that means "the recipient read it".
--
-- Unread is now "not written by me, and I have not looked at it": senderGhii <> ownerGhii AND
-- ownerReadAt IS NULL. The direction test it replaces was standing in for the same thing and stopped
-- being true the moment a mailbox held a row its owner had not written.
ALTER TABLE "DirectMessage" ADD COLUMN IF NOT EXISTS "ownerReadAt" TIMESTAMPTZ;

-- Backfill, and it must not disturb what anyone is looking at today.
--   inbound  → copy readAt across, so every currently-unread message stays unread and every read one
--              stays read. The badge is the same number after this migration as before it.
--   the rest → stamp as seen. These are rows the owner sent, plus the agent copies this change is
--              about; leaving them null would light up every support thread in the history at once.
UPDATE "DirectMessage" SET "ownerReadAt" = "readAt"
    WHERE "ownerReadAt" IS NULL AND "direction" = 'inbound';
UPDATE "DirectMessage" SET "ownerReadAt" = "createdAt"
    WHERE "ownerReadAt" IS NULL AND "direction" <> 'inbound';

-- The unread count asks this question per mailbox and per thread, so the index carries both.
CREATE INDEX IF NOT EXISTS "DirectMessage_ownerUnread_idx"
    ON "DirectMessage" ("ownerGhii", "conversationId")
    WHERE "ownerReadAt" IS NULL;
