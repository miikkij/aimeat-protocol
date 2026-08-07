-- 0029_company_smtp.sql
--
-- Per-company sending identity for the outbound door: a company sends under its OWN domain
-- and mailbox instead of the node's shared sender.
--
--   * Its own table rather than columns on "Company": most companies never set one, and a
--     row that exists only when configured makes "does this company send as itself?" a
--     presence question rather than a nullable-column question.
--   * "passwordEnc" is AES-256-GCM ciphertext (services/encryption.ts), never plaintext —
--     the same discipline the connection credentials use. The node refuses to store an SMTP
--     password at all when AIMEAT_ENCRYPTION_KEY is unset, rather than writing it in the clear.
--   * companyId is the primary key: one sending identity per company.

CREATE TABLE IF NOT EXISTS "CompanySmtp" (
  "companyId" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 587,
  "secure" BOOLEAN NOT NULL DEFAULT false,
  "username" TEXT,
  "passwordEnc" TEXT,
  "fromAddress" TEXT NOT NULL,
  "fromName" TEXT,
  "replyTo" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "CompanySmtp_pkey" PRIMARY KEY ("companyId")
);

CREATE INDEX IF NOT EXISTS "CompanySmtp_owner_idx" ON "CompanySmtp"("ownerGhii");
