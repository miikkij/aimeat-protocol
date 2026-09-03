/**
 * @file sqlite/schema-tables-4.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite CREATE TABLE/INDEX DDL — part 4 (company-in-a-box: the finance
 *   domain and the outbound door). Split from schema-tables-3.ts at the max-file-lines
 *   boundary; idempotent (IF NOT EXISTS), applied after part 3.
 * @version-history
 *   v1.5.0 — 2026-09-03 — dependency_edges and component_versions tables.
 *   v1.4.0 — 2026-08-26 — Workspace row spaces: rows a group accumulates, as a table rather than as
 *     memory keys, with the three declared index columns and the three times. Mirrors Postgres 0052.
 *   v1.3.0 — 2026-08-24 — The memory write tally: who has had their hands on a key, and how
 *     often. Permanent, no prune. Mirrors Postgres 0050.
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
      -- Which company sent it (its organism), null for an owner who has never split theirs.
      -- A NEW database gets the column here; an EXISTING one gets it from safeAddColumn in
      -- schema.ts, and both are needed or one of the two roads boots without it.
      organismId TEXT,
      -- WHO pressed send, as an exact principal. ownerGhii above is the BOOK (the company's owner
      -- once a company is named) and is shared by everyone sending for it, so without this a team
      -- of three produced a log in which every row looked identical. Same new/existing pair as
      -- organismId. Mirrors Postgres 0054.
      sentBy     TEXT,
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
    -- The daily cap counts this owner's sends in a rolling 24 h, and now optionally one company's.
    CREATE INDEX IF NOT EXISTS idx_outbound_messages_company ON outbound_messages(ownerGhii, organismId, createdAt);

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

    -- ── SSO connections (mirrors Postgres 0048, BR-04) ──
    -- One organisation's identity provider: the SAML sign-in half and the SCIM provisioning half.
    -- A table because it holds server-trusted secrets (SCIM token hash, IdP certificates) and two
    -- unauthenticated hot paths read it (the ACS and the SCIM bearer resolution).
    CREATE TABLE IF NOT EXISTS sso_connections (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      organismId         TEXT,
      domains            TEXT NOT NULL DEFAULT '[]',
      saml               TEXT,
      allowIdpInitiated  INTEGER NOT NULL DEFAULT 0,
      loginVisibility    TEXT NOT NULL DEFAULT 'listed',
      scimTokenHash      TEXT,
      scimTokenCreatedAt TEXT,
      lastScimRequestAt  TEXT,
      lastLoginAt        TEXT,
      createdBy          TEXT NOT NULL,
      createdAt          TEXT NOT NULL,
      updatedAt          TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_connections_scim_hash
      ON sso_connections(scimTokenHash) WHERE scimTokenHash IS NOT NULL;

    -- ── Memory write tally (TARGET-073) ──────────────────────────────────
    -- Who has had their hands on a memory key, and how often. THERE IS NO PRUNE JOB, and that is
    -- deliberate — every other rollup here keeps a window and this one keeps everything, because the
    -- count IS the record: a key gets rewritten, the value changes, and how many hands were on it is
    -- what nobody can reconstruct afterwards. A column on the memory row could not hold it (the next write
    -- overwrites it, so it would only name the last writer) and the row has to outlive the key.
    --
    -- An upsert, not a log. Measured 2026-08-24 on this node's heaviest owner: 18,446 keys carrying
    -- 990,452 lifetime writes, six of them over 10,800 each. Rows grow with distinct
    -- (key, principal) pairs, never with write volume.
    --
    -- It starts EMPTY and fills as things are written. Nothing seeds it and nothing can: the writer
    -- was never recorded, so there is no history to read back. Mirrors Postgres 0050.
    CREATE TABLE IF NOT EXISTS memory_write_tally (
      ownerGaii       TEXT    NOT NULL,
      key             TEXT    NOT NULL,
      writerPrincipal TEXT    NOT NULL,
      writeCount      INTEGER NOT NULL DEFAULT 0,
      deleteCount     INTEGER NOT NULL DEFAULT 0,
      firstAt         TEXT    NOT NULL,
      lastAt          TEXT    NOT NULL,
      PRIMARY KEY (ownerGaii, key, writerPrincipal)
    );
    CREATE INDEX IF NOT EXISTS idx_mwt_owner_key ON memory_write_tally(ownerGaii, key);
    CREATE INDEX IF NOT EXISTS idx_mwt_writer ON memory_write_tally(writerPrincipal);

    -- The same count folded to the key FAMILY, which is what a data-map row renders. The tier column is the
    -- basis the family was identified on AT THE TIME OF WRITING, stored rather than recomputed so a
    -- later improvement to the classifier cannot silently rewrite what was true a year ago.
    CREATE TABLE IF NOT EXISTS memory_family_tally (
      ownerGaii       TEXT    NOT NULL,
      keyFamily       TEXT    NOT NULL,
      writerPrincipal TEXT    NOT NULL,
      tier            TEXT    NOT NULL DEFAULT '',
      writeCount      INTEGER NOT NULL DEFAULT 0,
      deleteCount     INTEGER NOT NULL DEFAULT 0,
      firstAt         TEXT    NOT NULL,
      lastAt          TEXT    NOT NULL,
      PRIMARY KEY (ownerGaii, keyFamily, writerPrincipal)
    );
    CREATE INDEX IF NOT EXISTS idx_mft_owner_family ON memory_family_tally(ownerGaii, keyFamily);
    CREATE INDEX IF NOT EXISTS idx_mft_writer ON memory_family_tally(writerPrincipal);

    -- ── Workspace row spaces ───────────────────────────────────────────────────
    -- Rows a group accumulates in a workspace, as a table rather than as memory keys.
    -- Full rationale in Postgres 0052; the four measurements in short: an organism.* memory key
    -- counts against the MEMBER who wrote it, a versioned record keeps 20 copies, memory has no
    -- partial read or write, and the workspace index truncates at 5000 rows with no signal.
    --
    -- k1/k2/k3 are the manifest's indexOn fields denormalised into real columns, which is the
    -- answer to 0036's objection that a value inside JSONB cannot be ordered by in SQL.
    --
    -- occurredAt is when it happened in the world and is the search axis; createdAt is when it
    -- landed here and is what retention keys on; updatedAt answers "what changed since I looked".
    CREATE TABLE IF NOT EXISTS workspace_rows (
      id          TEXT    PRIMARY KEY,
      organismId  TEXT    NOT NULL,
      wsId        TEXT    NOT NULL,
      namespace   TEXT    NOT NULL,
      rowId       TEXT    NOT NULL,
      k1          TEXT    NOT NULL DEFAULT '',
      k2          TEXT    NOT NULL DEFAULT '',
      k3          TEXT    NOT NULL DEFAULT '',
      occurredAt  TEXT    NOT NULL,
      createdAt   TEXT    NOT NULL,
      updatedAt   TEXT    NOT NULL,
      createdBy   TEXT    NOT NULL DEFAULT '',
      body        TEXT    NOT NULL DEFAULT '{}',
      bytes       INTEGER NOT NULL DEFAULT 0
    );
    -- The identity a caller names. UNIQUE because a repeated rowId REPLACES rather than duplicates,
    -- so re-running an ingest that already landed is idempotent.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wsrows_space_rowid
      ON workspace_rows(organismId, wsId, namespace, rowId);
    -- THE read. The id is in the index rather than left to a sort: keyset pagination walks
    -- (occurredAt, id), and a page boundary between two rows of the same instant would otherwise
    -- skip or repeat one.
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_occurred
      ON workspace_rows(organismId, wsId, namespace, occurredAt DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_created
      ON workspace_rows(organismId, wsId, namespace, createdAt);
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_updated
      ON workspace_rows(organismId, wsId, namespace, updatedAt);
    -- Each declared column carries occurredAt, so a filtered read stays ordered without a sort.
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_k1
      ON workspace_rows(organismId, wsId, namespace, k1, occurredAt DESC) WHERE k1 <> '';
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_k2
      ON workspace_rows(organismId, wsId, namespace, k2, occurredAt DESC) WHERE k2 <> '';
    CREATE INDEX IF NOT EXISTS idx_wsrows_space_k3
      ON workspace_rows(organismId, wsId, namespace, k3, occurredAt DESC) WHERE k3 <> '';
    -- The quota gate's read: COUNT(*) and SUM(bytes) per organism, or per workspace inside it.
    CREATE INDEX IF NOT EXISTS idx_wsrows_org_ws ON workspace_rows(organismId, wsId);

    -- ── The dependency map (services/dependency-map.ts; mirrors Postgres 0065) ──
    -- Which app loads which cortex and calls which extension, and which cortex library calls
    -- which extension, read from the served bytes at publish and install time. A toKind 'none'
    -- row with an empty toName marks a source that was scanned and uses nothing.
    CREATE TABLE IF NOT EXISTS dependency_edges (
      fromKind    TEXT NOT NULL,
      fromRef     TEXT NOT NULL,
      fromVersion TEXT NOT NULL,
      toKind      TEXT NOT NULL,
      toName      TEXT NOT NULL,
      toVersion   TEXT,
      via         TEXT NOT NULL,
      updatedAt   TEXT NOT NULL,
      PRIMARY KEY (fromKind, fromRef, toKind, toName)
    );
    CREATE INDEX IF NOT EXISTS idx_depedge_to ON dependency_edges(toKind, toName);

    -- ── Kept extension and cortex versions (services/component-versions.ts; mirrors Postgres 0066) ──
    -- Every install and update stores a snapshot; name@1.2.0 in an address is served from it.
    CREATE TABLE IF NOT EXISTS component_versions (
      kind      TEXT NOT NULL,
      name      TEXT NOT NULL,
      version   TEXT NOT NULL,
      snapshot  TEXT NOT NULL,
      bytes     INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      PRIMARY KEY (kind, name, version)
    );

  `);
}
