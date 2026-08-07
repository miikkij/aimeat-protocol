/**
 * @file sqlite/schema-tables-4.ts
 * @description SQLite CREATE TABLE/INDEX DDL — part 4 (company-in-a-box: the finance
 *   domain and the outbound door). Split from schema-tables-3.ts at the max-file-lines
 *   boundary; idempotent (IF NOT EXISTS), applied after part 3.
 * @version-history
 *   v1.0.0 — 2026-08-06 — Finance (invoices/vouchers/VAT/fiscal years/counters) + outbound
 *     (contacts/send log), moved from schema-tables-3.ts.
 */
import type Database from 'better-sqlite3';

export function applySchemaTables4(db: Database.Database): void {
  db.exec(`
    -- ── Finance domain (company-in-a-box phase 1) ──────────────────────────────
    -- Sales invoices (Finvoice 3.0), accounting vouchers (tositteet), the node-global
    -- VAT-code registry, fiscal years and atomic number counters. Money is integer
    -- minor units (cents); VAT rates are basis points (2550 = 25.5 %) and live in
    -- finance_vat_codes with validity windows — the reduced rate changed 14 % -> 13.5 %
    -- on 2026-01-01, which is why rates are data, not code. Tables carry the finance_
    -- prefix because "invoice" already names the io.aimeat.invoice payment RAIL in
    -- src/commerce/; these are bookkeeping documents, a different thing.

    -- numberSeq stays NULL while a draft: the number is claimed atomically from
    -- finance_counters on the draft->sent transition so the sequence is gapless
    -- (a deleted draft never consumes a number). Partial unique index enforces one
    -- number per owner among sent invoices only.
    CREATE TABLE IF NOT EXISTS finance_invoices (
      id                TEXT PRIMARY KEY,
      ownerGhii         TEXT NOT NULL,
      organismId        TEXT,
      type              TEXT NOT NULL DEFAULT 'invoice',
      creditsInvoiceId  TEXT,
      status            TEXT NOT NULL DEFAULT 'draft',
      numberSeq         INTEGER,
      invoiceNumber     TEXT,
      seller            TEXT NOT NULL,
      buyer             TEXT NOT NULL,
      lines             TEXT NOT NULL DEFAULT '[]',
      currency          TEXT NOT NULL DEFAULT 'EUR',
      totalNetMinor     INTEGER NOT NULL DEFAULT 0,
      totalVatMinor     INTEGER NOT NULL DEFAULT 0,
      totalGrossMinor   INTEGER NOT NULL DEFAULT 0,
      vatBreakdown      TEXT NOT NULL DEFAULT '[]',
      referenceNumber   TEXT,
      paymentTermsDays  INTEGER NOT NULL DEFAULT 14,
      invoiceDate       TEXT,
      dueDate           TEXT,
      deliveryMethod    TEXT,
      sentAt            TEXT,
      deliveryStatus    TEXT,
      operatorMessageId TEXT,
      finvoiceXmlKey    TEXT,
      paidAt            TEXT,
      paidTrackingCode  TEXT,
      externalRef       TEXT,
      fiscalYearId      TEXT,
      notes             TEXT,
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_owner ON finance_invoices(ownerGhii, status);
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_owner_date ON finance_invoices(ownerGhii, invoiceDate);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_invoices_owner_seq
      ON finance_invoices(ownerGhii, numberSeq) WHERE numberSeq IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_finance_invoices_reference
      ON finance_invoices(ownerGhii, referenceNumber) WHERE referenceNumber IS NOT NULL;

    -- Append-only: there is no UPDATE path except the attachments list (added evidence
    -- never changes the booking). Corrections are new vouchers with reversesVoucherId set.
    CREATE TABLE IF NOT EXISTS finance_vouchers (
      id                TEXT PRIMARY KEY,
      ownerGhii         TEXT NOT NULL,
      organismId        TEXT,
      fiscalYearId      TEXT NOT NULL,
      voucherNumber     INTEGER NOT NULL,
      date              TEXT NOT NULL,
      description       TEXT NOT NULL,
      direction         TEXT NOT NULL,
      source            TEXT NOT NULL,
      amountMinor       INTEGER NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'EUR',
      vatBreakdown      TEXT NOT NULL DEFAULT '[]',
      counterparty      TEXT,
      invoiceId         TEXT,
      trackingCode      TEXT,
      externalRef       TEXT,
      attachments       TEXT NOT NULL DEFAULT '[]',
      reversesVoucherId TEXT,
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_vouchers_year_number
      ON finance_vouchers(ownerGhii, fiscalYearId, voucherNumber);
    CREATE INDEX IF NOT EXISTS idx_finance_vouchers_owner_date ON finance_vouchers(ownerGhii, date);
    -- Webhook idempotency: one booking per external event per owner.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_vouchers_external
      ON finance_vouchers(ownerGhii, externalRef) WHERE externalRef IS NOT NULL;

    CREATE TABLE IF NOT EXISTS finance_vat_codes (
      id          TEXT PRIMARY KEY,
      countryCode TEXT NOT NULL DEFAULT 'FI',
      category    TEXT NOT NULL,
      rateBp      INTEGER NOT NULL,
      label       TEXT NOT NULL,
      validFrom   TEXT NOT NULL,
      validTo     TEXT,
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_fiscal_years (
      id         TEXT PRIMARY KEY,
      ownerGhii  TEXT NOT NULL,
      organismId TEXT,
      label      TEXT NOT NULL,
      startDate  TEXT NOT NULL,
      endDate    TEXT NOT NULL,
      locked     INTEGER NOT NULL DEFAULT 0,
      lockedAt   TEXT,
      createdAt  TEXT NOT NULL,
      updatedAt  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_fiscal_years_owner ON finance_fiscal_years(ownerGhii, startDate);

    -- Named counters: kind is 'invoice' (per owner) or 'voucher:{fiscalYearId}'. The next
    -- value is claimed with one INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement,
    -- so the guarantee comes from the statement, not from the runtime being single-threaded.
    CREATE TABLE IF NOT EXISTS finance_counters (
      ownerGhii TEXT NOT NULL,
      kind      TEXT NOT NULL,
      value     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ownerGhii, kind)
    );

    -- ── Outbound door (company-in-a-box phase 2) ───────────────────────────────
    -- Recipient registry: /v1/outbound/send takes a contact id, never a free address —
    -- that is the structural anti-spam device. One entry per owner per lower-cased email;
    -- optOutToken backs the public unsubscribe link (unguessable, unique).
    CREATE TABLE IF NOT EXISTS outbound_contacts (
      id           TEXT PRIMARY KEY,
      ownerGhii    TEXT NOT NULL,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      ghii         TEXT,
      tags         TEXT NOT NULL DEFAULT '[]',
      optedOut     INTEGER NOT NULL DEFAULT 0,
      optOutAt     TEXT,
      optOutToken  TEXT NOT NULL,
      bounceCount  INTEGER NOT NULL DEFAULT 0,
      suppressedAt TEXT,
      notes        TEXT,
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_contacts_owner_email
      ON outbound_contacts(ownerGhii, lower(email));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_contacts_token ON outbound_contacts(optOutToken);
    CREATE INDEX IF NOT EXISTS idx_outbound_contacts_owner ON outbound_contacts(ownerGhii, createdAt);

    -- Append-only send log (the GDPR-answerable record of what left the node). The daily
    -- limit counts rows here in SQL — a gate and a display must not drift.
    CREATE TABLE IF NOT EXISTS outbound_messages (
      id         TEXT PRIMARY KEY,
      ownerGhii  TEXT NOT NULL,
      contactId  TEXT NOT NULL,
      channel    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      subject    TEXT NOT NULL,
      templateId TEXT,
      status     TEXT NOT NULL,
      error      TEXT,
      invoiceId  TEXT,
      createdAt  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbound_messages_owner ON outbound_messages(ownerGhii, createdAt);
    CREATE INDEX IF NOT EXISTS idx_outbound_messages_contact ON outbound_messages(contactId, createdAt);

    -- ── Company registry (company-in-a-box) ───────────────────────────────────
    -- A company is a first-class entity like an app; creating one reserves
    -- {slug}.co.<apex>. The slug lives HERE rather than in subdomain_sites because that
    -- table is one flat label namespace shared by the apps family — a company named
    -- "tinki" must not collide with an app named "tinki", they are different hosts.
    -- The unique index on lower(slug) is the arbitration for concurrent claims.
    -- The legal-identity columns are the seller-party snapshot an invoice needs, so a
    -- founder types them once and every later invoice prefills from them.
    CREATE TABLE IF NOT EXISTS companies (
      id               TEXT PRIMARY KEY,
      slug             TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL,
      name             TEXT NOT NULL,
      description      TEXT,
      organismId       TEXT,
      frontPageKind    TEXT NOT NULL DEFAULT 'none',
      frontPageTarget  TEXT NOT NULL DEFAULT '',
      businessId       TEXT,
      vatId            TEXT,
      streetAddress    TEXT,
      postalCode       TEXT,
      city             TEXT,
      country          TEXT,
      email            TEXT,
      phone            TEXT,
      iban             TEXT,
      bic              TEXT,
      einvoiceAddress  TEXT,
      einvoiceOperator TEXT,
      status           TEXT NOT NULL DEFAULT 'active',
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_slug ON companies(lower(slug));
    CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(ownerGhii, createdAt);

  `);
}
