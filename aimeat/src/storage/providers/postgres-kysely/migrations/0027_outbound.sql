-- 0027_outbound.sql
--
-- Company-in-a-box phase 2: the outbound messaging door — recipient registry and the
-- append-only send log.
--
--   * OutboundContact is the structural anti-spam device: /v1/outbound/send accepts a
--     contact id, never a free address, so every recipient is a saved entry carrying its
--     own opt-out and bounce state. One entry per owner per email (unique index on the
--     lower-cased address). "optOutToken" backs the public unsubscribe link, so it gets
--     its own unique index and must be unguessable.
--   * OutboundMessage is the send log (GDPR-answerable "what left this node"), append-only.
--     The daily limit counts rows here in SQL — a gate and a display must not drift.

CREATE TABLE IF NOT EXISTS "OutboundContact" (
  "id" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ghii" TEXT,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "optedOut" BOOLEAN NOT NULL DEFAULT false,
  "optOutAt" TEXT,
  "optOutToken" TEXT NOT NULL,
  "bounceCount" INTEGER NOT NULL DEFAULT 0,
  "suppressedAt" TEXT,
  "notes" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "OutboundContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboundContact_owner_email_key" ON "OutboundContact"("ownerGhii", lower("email"));
CREATE UNIQUE INDEX IF NOT EXISTS "OutboundContact_token_key" ON "OutboundContact"("optOutToken");
CREATE INDEX IF NOT EXISTS "OutboundContact_owner_idx" ON "OutboundContact"("ownerGhii", "createdAt");

CREATE TABLE IF NOT EXISTS "OutboundMessage" (
  "id" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "templateId" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "invoiceId" TEXT,
  "createdAt" TEXT NOT NULL,
  CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboundMessage_owner_idx" ON "OutboundMessage"("ownerGhii", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_contact_idx" ON "OutboundMessage"("contactId", "createdAt");
