-- 0026_finance.sql
--
-- Company-in-a-box phase 1: the generic finance domain — sales invoices (Finvoice 3.0),
-- accounting vouchers (tositteet), the node-global VAT-code registry, fiscal years and
-- the atomic counters behind gapless invoice/voucher numbering.
--
-- Design notes:
--   * Tables are prefixed Finance* because "invoice" already means the io.aimeat.invoice
--     payment RAIL in src/commerce/ (settle offline); these are bookkeeping documents.
--   * Money is integer minor units (cents); VAT rates are basis points (2550 = 25.5 %).
--     Rates live in FinanceVatCode with validity windows — the reduced rate changed
--     14 % -> 13.5 % on 2026-01-01, which is why rates are data, not code.
--   * FinanceVoucher is append-only: no UPDATE path except the attachments list
--     (added evidence never changes the booking). Corrections are new vouchers with
--     "reversesVoucherId" set.
--   * "numberSeq" is NULL while an invoice is a draft; the number is claimed atomically
--     from FinanceCounter on the draft->sent transition so the sequence stays gapless
--     (a deleted draft never consumes a number). The partial unique index enforces
--     one number per owner among sent invoices only.
--   * No foreign keys, matching the rest of the schema: "trackingCode" joins to the
--     commerce books (memory records), "externalRef" to Stripe/bank ids.

CREATE TABLE IF NOT EXISTS "FinanceInvoice" (
  "id" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "organismId" TEXT,
  "type" TEXT NOT NULL DEFAULT 'invoice',
  "creditsInvoiceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "numberSeq" INTEGER,
  "invoiceNumber" TEXT,
  "seller" JSONB NOT NULL,
  "buyer" JSONB NOT NULL,
  "lines" JSONB NOT NULL DEFAULT '[]',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "totalNetMinor" BIGINT NOT NULL DEFAULT 0,
  "totalVatMinor" BIGINT NOT NULL DEFAULT 0,
  "totalGrossMinor" BIGINT NOT NULL DEFAULT 0,
  "vatBreakdown" JSONB NOT NULL DEFAULT '[]',
  "referenceNumber" TEXT,
  "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
  "invoiceDate" TEXT,
  "dueDate" TEXT,
  "deliveryMethod" TEXT,
  "sentAt" TEXT,
  "deliveryStatus" TEXT,
  "operatorMessageId" TEXT,
  "finvoiceXmlKey" TEXT,
  "paidAt" TEXT,
  "paidTrackingCode" TEXT,
  "externalRef" TEXT,
  "fiscalYearId" TEXT,
  "notes" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "FinanceInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinanceInvoice_owner_idx" ON "FinanceInvoice"("ownerGhii", "status");
CREATE INDEX IF NOT EXISTS "FinanceInvoice_owner_date_idx" ON "FinanceInvoice"("ownerGhii", "invoiceDate");
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceInvoice_owner_seq_key" ON "FinanceInvoice"("ownerGhii", "numberSeq") WHERE "numberSeq" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "FinanceInvoice_reference_idx" ON "FinanceInvoice"("ownerGhii", "referenceNumber") WHERE "referenceNumber" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "FinanceVoucher" (
  "id" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "organismId" TEXT,
  "fiscalYearId" TEXT NOT NULL,
  "voucherNumber" INTEGER NOT NULL,
  "date" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "vatBreakdown" JSONB NOT NULL DEFAULT '[]',
  "counterparty" TEXT,
  "invoiceId" TEXT,
  "trackingCode" TEXT,
  "externalRef" TEXT,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "reversesVoucherId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "FinanceVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinanceVoucher_year_number_key" ON "FinanceVoucher"("ownerGhii", "fiscalYearId", "voucherNumber");
CREATE INDEX IF NOT EXISTS "FinanceVoucher_owner_date_idx" ON "FinanceVoucher"("ownerGhii", "date");
-- Webhook idempotency lookup: one booking per external event per owner.
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceVoucher_external_key" ON "FinanceVoucher"("ownerGhii", "externalRef") WHERE "externalRef" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "FinanceVatCode" (
  "id" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL DEFAULT 'FI',
  "category" TEXT NOT NULL,
  "rateBp" INTEGER NOT NULL,
  "label" JSONB NOT NULL,
  "validFrom" TEXT NOT NULL,
  "validTo" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "FinanceVatCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinanceFiscalYear" (
  "id" TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "organismId" TEXT,
  "label" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "lockedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "FinanceFiscalYear_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinanceFiscalYear_owner_idx" ON "FinanceFiscalYear"("ownerGhii", "startDate");

-- Named counters: kind is 'invoice' (per owner) or 'voucher:{fiscalYearId}'.
-- The next value is claimed with a single INSERT ... ON CONFLICT DO UPDATE RETURNING,
-- so two concurrent sends can never share a number.
CREATE TABLE IF NOT EXISTS "FinanceCounter" (
  "ownerGhii" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FinanceCounter_pkey" PRIMARY KEY ("ownerGhii", "kind")
);
