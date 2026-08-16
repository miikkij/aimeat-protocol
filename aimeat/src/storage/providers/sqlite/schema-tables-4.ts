/**
 * @file sqlite/schema-tables-4.ts
 * @description SQLite CREATE TABLE/INDEX DDL — part 4 (company-in-a-box: the finance
 *   domain and the outbound door). Split from schema-tables-3.ts at the max-file-lines
 *   boundary; idempotent (IF NOT EXISTS), applied after part 3.
 * @version-history
 *   v1.2.0 — 2026-08-17 — Account events: the per-owner "what has happened" window and its archive.
 *     Mirrors Postgres 0042.
 *   v1.1.0 — 2026-08-14 — Usage telemetry: the hot call stream, the two archive tables, the
 *     discriminated serving rollup and its watermark. Mirrors Postgres 0036.
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
      emailHash    TEXT NOT NULL DEFAULT '',
      ghii         TEXT,
      tags         TEXT NOT NULL DEFAULT '[]',
      links        TEXT NOT NULL DEFAULT '[]',
      relation     TEXT,
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
    -- NOTE: the index over emailHash (TARGET-063) is NOT here, and must not be. This block runs
    -- BEFORE schema.ts adds columns to existing tables, and on an upgraded database CREATE TABLE
    -- IF NOT EXISTS is a no-op — so an index naming a new column would reference one that does not
    -- exist yet and kill the boot. It lives beside its safeAddColumn call instead, which is
    -- idempotent and therefore also correct on a fresh database.

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

    -- A company's own sending identity for the outbound door: its own table because most
    -- companies never set one, so "sends as itself" is a presence question rather than a
    -- nullable-column one. passwordEnc is AES-256-GCM ciphertext (services/encryption.ts):
    -- a password is never stored in the clear, and without an encryption key the node
    -- refuses to store one at all.
    CREATE TABLE IF NOT EXISTS company_smtp (
      companyId   TEXT PRIMARY KEY,
      ownerGhii   TEXT NOT NULL,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL DEFAULT 587,
      secure      INTEGER NOT NULL DEFAULT 0,
      username    TEXT,
      passwordEnc TEXT,
      fromAddress TEXT NOT NULL,
      fromName    TEXT,
      replyTo     TEXT,
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_company_smtp_owner ON company_smtp(ownerGhii);

    -- ── Account events ────────────────────────────────────────────────────────
    -- What has happened on one person's account, as its own system rather than as
    -- memory records. Memory is the person's own refined knowledge; these are events
    -- the node generated about them, and mixing the two spends their key budget on
    -- rows they never wrote and puts machine chatter in front of their librarian.
    -- Mirrors Postgres 0042.
    --
    -- The hot table holds the last 100 per owner so "what happened lately" is always
    -- one indexed read. Overflow moves to the archive: browsable, slower by design,
    -- and never deleted by this mechanism.
    CREATE TABLE IF NOT EXISTS account_events (
      id        TEXT PRIMARY KEY,
      ownerGhii TEXT NOT NULL,
      at        TEXT NOT NULL,
      -- A stable key the UI translates, never a sentence: the node does not decide
      -- which language the person reads.
      kind      TEXT NOT NULL,
      actorGaii TEXT NOT NULL DEFAULT '',
      data      TEXT NOT NULL DEFAULT '{}',
      link      TEXT NOT NULL DEFAULT '',
      subject   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_account_events_owner ON account_events(ownerGhii, at DESC);

    CREATE TABLE IF NOT EXISTS account_events_archive (
      id         TEXT PRIMARY KEY,
      ownerGhii  TEXT NOT NULL,
      at         TEXT NOT NULL,
      kind       TEXT NOT NULL,
      actorGaii  TEXT NOT NULL DEFAULT '',
      data       TEXT NOT NULL DEFAULT '{}',
      link       TEXT NOT NULL DEFAULT '',
      subject    TEXT NOT NULL DEFAULT '',
      archivedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_events_archive_owner ON account_events_archive(ownerGhii, at DESC);

    -- ── Usage telemetry ───────────────────────────────────────────────────────
    -- Three layers, mirroring Postgres 0036. Full rationale:
    -- docs/internal/telemetria/02-design.md
    --   hot raw   usage_calls (+ the existing agent_usage_event), 90 days
    --   cold      usage_calls_archive, agent_usage_event_archive — storage, never a data source
    --   serving   usage_rollup — everything a dashboard reads, precomputed incrementally

    -- One row per observable call, whichever door it came through. The outcome and reason columns are the
    -- point of the table: a refused call is the record that a capability was wanted and not
    -- delivered, and nothing recorded that before.
    CREATE TABLE IF NOT EXISTS usage_calls (
      id               TEXT PRIMARY KEY,
      ts               TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL,
      actorGaii        TEXT NOT NULL DEFAULT '',
      actorKind        TEXT NOT NULL DEFAULT 'owner',
      surface          TEXT NOT NULL,
      coordinate       TEXT NOT NULL DEFAULT '',
      appId            TEXT NOT NULL DEFAULT '',
      counterpartyGhii TEXT NOT NULL DEFAULT '',
      outcome          TEXT NOT NULL DEFAULT 'ok',
      reason           TEXT NOT NULL DEFAULT '',
      durationMs       INTEGER NOT NULL DEFAULT 0,
      chargedUnits     INTEGER NOT NULL DEFAULT 0,
      unit             TEXT NOT NULL DEFAULT '',
      currency         TEXT NOT NULL DEFAULT '',
      entitlementId    TEXT NOT NULL DEFAULT '',
      runId            TEXT NOT NULL DEFAULT '',
      meta             TEXT NOT NULL DEFAULT '{}'
    );
    -- (ts, id) is a total order over the stream, so the fold's watermark can resume exactly.
    CREATE INDEX IF NOT EXISTS idx_usage_calls_cursor ON usage_calls(ts, id);
    CREATE INDEX IF NOT EXISTS idx_usage_calls_owner ON usage_calls(ownerGhii, ts DESC);

    CREATE TABLE IF NOT EXISTS usage_calls_archive (
      id               TEXT PRIMARY KEY,
      ts               TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL,
      actorGaii        TEXT NOT NULL DEFAULT '',
      actorKind        TEXT NOT NULL DEFAULT 'owner',
      surface          TEXT NOT NULL,
      coordinate       TEXT NOT NULL DEFAULT '',
      appId            TEXT NOT NULL DEFAULT '',
      counterpartyGhii TEXT NOT NULL DEFAULT '',
      outcome          TEXT NOT NULL DEFAULT 'ok',
      reason           TEXT NOT NULL DEFAULT '',
      durationMs       INTEGER NOT NULL DEFAULT 0,
      chargedUnits     INTEGER NOT NULL DEFAULT 0,
      unit             TEXT NOT NULL DEFAULT '',
      currency         TEXT NOT NULL DEFAULT '',
      entitlementId    TEXT NOT NULL DEFAULT '',
      runId            TEXT NOT NULL DEFAULT '',
      meta             TEXT NOT NULL DEFAULT '{}',
      archivedAt       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_calls_archive_owner ON usage_calls_archive(ownerGhii, ts);

    CREATE TABLE IF NOT EXISTS agent_usage_event_archive (
      id               TEXT PRIMARY KEY,
      ts               TEXT NOT NULL,
      agentGaii        TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL,
      runId            TEXT,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      promptTokens     INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      costUsd          REAL,
      priceRef         TEXT,
      source           TEXT NOT NULL,
      apiKeyScope      TEXT NOT NULL DEFAULT 'own',
      organismId       TEXT,
      workspaceId      TEXT,
      capabilityId     TEXT,
      consumerGhii     TEXT,
      provenanceId     TEXT,
      appId            TEXT NOT NULL DEFAULT '',
      surface          TEXT NOT NULL DEFAULT '',
      archivedAt       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_event_archive_owner ON agent_usage_event_archive(ownerGhii, ts);

    -- The one table every dashboard reads. The cut column names which dimensions this row is keyed by;
    -- a dimension outside the cut holds '' (never NULL) so the unique key is total and the
    -- upsert is a plain ON CONFLICT DO UPDATE SET x = x + excluded.x.
    CREATE TABLE IF NOT EXISTS usage_rollup (
      id               TEXT PRIMARY KEY,
      cut              TEXT NOT NULL,
      grain            TEXT NOT NULL,
      bucket           TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL DEFAULT '',
      actorGaii        TEXT NOT NULL DEFAULT '',
      appId            TEXT NOT NULL DEFAULT '',
      model            TEXT NOT NULL DEFAULT '',
      provider         TEXT NOT NULL DEFAULT '',
      surface          TEXT NOT NULL DEFAULT '',
      outcome          TEXT NOT NULL DEFAULT '',
      coordinate       TEXT NOT NULL DEFAULT '',
      counterpartyGhii TEXT NOT NULL DEFAULT '',
      calls            INTEGER NOT NULL DEFAULT 0,
      errors           INTEGER NOT NULL DEFAULT 0,
      refusals         INTEGER NOT NULL DEFAULT 0,
      tokensIn         INTEGER NOT NULL DEFAULT 0,
      tokensOut        INTEGER NOT NULL DEFAULT 0,
      costUsd          REAL NOT NULL DEFAULT 0,
      unpricedCalls    INTEGER NOT NULL DEFAULT 0,
      chargedUnits     INTEGER NOT NULL DEFAULT 0,
      durationMsSum    INTEGER NOT NULL DEFAULT 0,
      durationMsMax    INTEGER NOT NULL DEFAULT 0,
      -- Distinct actors within one fold batch, summed across batches: an approximation FROM
      -- BELOW. Labelled as such wherever it is served, never used for billing.
      actorsSeen       INTEGER NOT NULL DEFAULT 0,
      extra            TEXT NOT NULL DEFAULT '{}',
      updatedAt        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_rollup_key ON usage_rollup(
      cut, grain, bucket, ownerGhii, actorGaii, appId, model, provider,
      surface, outcome, coordinate, counterpartyGhii
    );
    CREATE INDEX IF NOT EXISTS idx_usage_rollup_read ON usage_rollup(cut, grain, bucket);
    CREATE INDEX IF NOT EXISTS idx_usage_rollup_owner ON usage_rollup(cut, ownerGhii, grain, bucket);

    -- One row per raw stream. Advanced in the SAME transaction as the deltas it accounts for,
    -- which is what makes the fold exactly-once.
    CREATE TABLE IF NOT EXISTS usage_rollup_state (
      stream    TEXT PRIMARY KEY,
      lastTs    TEXT NOT NULL DEFAULT '',
      lastId    TEXT NOT NULL DEFAULT '',
      updatedAt TEXT NOT NULL
    );

  `);
}
