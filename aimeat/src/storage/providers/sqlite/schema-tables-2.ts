/**
 * @file sqlite/schema-tables-2.ts
 * @description SQLite CREATE TABLE/INDEX DDL — part 2 of 3 (extensions … ecosystem automation recipes). Extracted from sqlite/schema.ts
 *   to satisfy max-file-lines. Idempotent (IF NOT EXISTS); applied in numeric order so
 *   the on-disk DDL order is byte-for-byte unchanged from the original single exec block.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from sqlite/schema.ts (max-file-lines)
 */
import type Database from 'better-sqlite3';

export function applySchemaTables2(db: Database.Database): void {
  db.exec(`
    -- ── Extensions ──
    CREATE TABLE IF NOT EXISTS extensions (
      name           TEXT PRIMARY KEY,
      version        TEXT NOT NULL,
      description    TEXT NOT NULL,
      author         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'inactive',
      requiredApis   TEXT NOT NULL DEFAULT '[]',
      actions        TEXT NOT NULL DEFAULT '[]',
      config         TEXT NOT NULL DEFAULT '{}',
      limits         TEXT NOT NULL DEFAULT '{}',
      federation     TEXT NOT NULL DEFAULT '{}',
      instances      TEXT,
      installedBy    TEXT NOT NULL,
      installedAt    TEXT NOT NULL,
      activatedAt    TEXT
    );

    -- ── Escrow Holds ──
    CREATE TABLE IF NOT EXISTS escrow_holds (
      holdId         TEXT PRIMARY KEY,
      fromGaii       TEXT NOT NULL,
      amount         REAL NOT NULL DEFAULT 0,
      reason         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'held',
      extensionName  TEXT NOT NULL,
      createdAt      TEXT NOT NULL,
      releasedAt     TEXT,
      releasedTo     TEXT
    );

    -- ── Cortex Extensions ──
    CREATE TABLE IF NOT EXISTS cortex_extensions (
      name               TEXT PRIMARY KEY,
      namespace          TEXT NOT NULL,
      shortName          TEXT NOT NULL,
      apiVersion         TEXT NOT NULL,
      version            TEXT NOT NULL,
      description        TEXT NOT NULL,
      author             TEXT NOT NULL,
      license            TEXT,
      tags               TEXT NOT NULL DEFAULT '[]',
      labels             TEXT NOT NULL DEFAULT '{}',
      aimeatCompat       TEXT,
      status             TEXT NOT NULL DEFAULT 'inactive',
      visibility         TEXT NOT NULL DEFAULT 'private',
      installedAt        TEXT NOT NULL,
      activatedAt        TEXT,
      installedBy        TEXT NOT NULL,
      manifest           TEXT NOT NULL,
      components         TEXT NOT NULL DEFAULT '[]',
      activationArtifacts TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS cortex_lib_files (
      extName            TEXT NOT NULL,
      libName            TEXT NOT NULL,
      content            TEXT NOT NULL,
      PRIMARY KEY (extName, libName)
    );

    -- ── Sessions (P3-7: Server-Side Session Tracking) ──
    CREATE TABLE IF NOT EXISTS sessions (
      sessionId         TEXT PRIMARY KEY,
      gaii              TEXT NOT NULL,
      owner             TEXT NOT NULL,
      issuedAt          TEXT NOT NULL,
      expiresAt         TEXT NOT NULL,
      revoked           INTEGER NOT NULL DEFAULT 0,
      -- Owner refresh-token fields (NULL for legacy JWT-tracking sessions)
      refreshTokenHash  TEXT,
      prevTokenHash     TEXT,
      prevValidUntil    TEXT,
      lastUsedAt        TEXT,
      idleExpiresAt     TEXT,
      absoluteExpiresAt TEXT,
      deviceLabel       TEXT,
      userAgent         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner);
    CREATE INDEX IF NOT EXISTS idx_sessions_gaii ON sessions(gaii);

    -- ── Personal Access Tokens (owner-created tokens for agents) ──
    CREATE TABLE IF NOT EXISTS personal_access_tokens (
      id             TEXT PRIMARY KEY,
      tokenHash      TEXT NOT NULL,
      label          TEXT NOT NULL,
      owner          TEXT NOT NULL,
      scopes         TEXT,
      grantOwner     INTEGER NOT NULL DEFAULT 0,
      grantOperator  INTEGER NOT NULL DEFAULT 0,
      readOwnerData  INTEGER NOT NULL DEFAULT 0,
      gaii           TEXT NOT NULL,
      createdAt      TEXT NOT NULL,
      expiresAt      TEXT,
      lastUsedAt     TEXT,
      revoked        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pat_tokenHash ON personal_access_tokens(tokenHash);
    CREATE INDEX IF NOT EXISTS idx_pat_owner ON personal_access_tokens(owner);

    -- ── Email invitations (invite people not yet in the system into an organism + workspaces) ──
    CREATE TABLE IF NOT EXISTS invitations (
      id               TEXT PRIMARY KEY,
      tokenHash        TEXT NOT NULL,
      organismId       TEXT NOT NULL,
      orgRole          TEXT NOT NULL DEFAULT 'member',
      type             TEXT NOT NULL DEFAULT 'link',
      workspaces       TEXT NOT NULL DEFAULT '[]',
      email            TEXT NOT NULL,
      emailHash        TEXT NOT NULL,
      invitedBy        TEXT NOT NULL,
      provisionedOwner TEXT,
      message          TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      createdAt        TEXT NOT NULL,
      expiresAt        TEXT NOT NULL,
      acceptedAt       TEXT,
      acceptedBy       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_tokenHash ON invitations(tokenHash);
    CREATE INDEX IF NOT EXISTS idx_invitations_organismId ON invitations(organismId);
    CREATE INDEX IF NOT EXISTS idx_invitations_emailHash ON invitations(emailHash);
    CREATE INDEX IF NOT EXISTS idx_invitations_expiresAt ON invitations(expiresAt);
    CREATE INDEX IF NOT EXISTS idx_invitations_invitedBy ON invitations(invitedBy);

    -- ── Revoked Tokens ──
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash     TEXT PRIMARY KEY,
      expires_at     INTEGER NOT NULL
    );

    -- ── Node Key (single-row) ──
    CREATE TABLE IF NOT EXISTS node_key (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      publicKey      TEXT NOT NULL,
      privateKey     TEXT NOT NULL
    );

    -- ── Maintenance Mode (single-row) ──
    CREATE TABLE IF NOT EXISTS maintenance (
      id             INTEGER PRIMARY KEY DEFAULT 1,
      enabled        INTEGER NOT NULL DEFAULT 0,
      message        TEXT NOT NULL DEFAULT '',
      enabledAt      TEXT,
      enabledBy      TEXT
    );

    -- ── Personal Push Subscriptions (REQ-007) ──
    CREATE TABLE IF NOT EXISTS personal_push_subscriptions (
      id              TEXT PRIMARY KEY,
      personalNodeId  TEXT NOT NULL,
      ownerName       TEXT NOT NULL,
      endpoint        TEXT NOT NULL,
      keys            TEXT NOT NULL DEFAULT '{}',
      failureCount    INTEGER NOT NULL DEFAULT 0,
      createdAt       TEXT NOT NULL,
      lastUsedAt      TEXT
    );

    -- ── Notification Preferences (REQ-007) ──
    CREATE TABLE IF NOT EXISTS notification_preferences (
      personalNodeId  TEXT PRIMARY KEY,
      enabled         INTEGER NOT NULL DEFAULT 1,
      channels        TEXT NOT NULL DEFAULT '["web_push"]',
      notifyTypes     TEXT NOT NULL DEFAULT '["work_assignment","action_request"]',
      cooldownMinutes INTEGER NOT NULL DEFAULT 5,
      quietHoursUtc   TEXT,
      email           TEXT
    );

    -- ── Notification Templates (Phase 3.2) ──
    CREATE TABLE IF NOT EXISTS notification_templates (
      id            TEXT NOT NULL,
      locale        TEXT NOT NULL,
      fields        TEXT NOT NULL DEFAULT '{}',
      placeholders  TEXT NOT NULL DEFAULT '[]',
      updatedAt     TEXT NOT NULL,
      updatedBy     TEXT NOT NULL,
      PRIMARY KEY (id, locale)
    );

    -- ── App Catalog (versioned apps with manifest) ──
    CREATE TABLE IF NOT EXISTS apps (
      ownerGaii      TEXT NOT NULL,
      ownerName      TEXT NOT NULL,
      filename       TEXT NOT NULL,
      versionNumber  INTEGER NOT NULL DEFAULT 1,
      manifest       TEXT NOT NULL DEFAULT '{}',
      mimeType       TEXT NOT NULL DEFAULT 'text/html',
      size           INTEGER NOT NULL DEFAULT 0,
      data           BLOB,
      accessCode     TEXT,
      parked         INTEGER NOT NULL DEFAULT 0,
      forkable       INTEGER NOT NULL DEFAULT 0,
      operatorHidden INTEGER NOT NULL DEFAULT 0,
      operatorHiddenBy   TEXT,
      operatorHiddenAt   TEXT,
      operatorHideReason TEXT,
      createdAt      TEXT NOT NULL,
      PRIMARY KEY (ownerGaii, filename, versionNumber)
    );

    CREATE TABLE IF NOT EXISTS app_downloads (
      ownerGaii      TEXT NOT NULL,
      filename       TEXT NOT NULL,
      downloads      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ownerGaii, filename)
    );

    -- ── App drafts (staging slot; at most one per owner+filename). The live
    --    published versions live in the apps table; this holds an unpublished draft
    --    that is preview-only (owner, via a signed draft-preview token) until it is
    --    published, which promotes it into apps and clears this row. ──
    CREATE TABLE IF NOT EXISTS app_drafts (
      ownerGaii      TEXT NOT NULL,
      ownerName      TEXT NOT NULL,
      filename       TEXT NOT NULL,
      manifest       TEXT NOT NULL DEFAULT '{}',
      mimeType       TEXT NOT NULL DEFAULT 'text/html',
      size           INTEGER NOT NULL DEFAULT 0,
      data           BLOB,
      updatedAt      TEXT NOT NULL,
      PRIMARY KEY (ownerGaii, filename)
    );

    -- ── App Fork lineage (append-only event log; source of truth for fork
    --    statistics + the cross-owner lineage graph) ──
    CREATE TABLE IF NOT EXISTS app_forks (
      id                TEXT PRIMARY KEY,
      sourceOwnerGaii   TEXT NOT NULL,
      sourceOwnerName   TEXT NOT NULL,
      sourceFilename    TEXT NOT NULL,
      sourceVersion     INTEGER NOT NULL,
      childOwnerGaii    TEXT NOT NULL,
      childOwnerName    TEXT NOT NULL,
      childFilename     TEXT NOT NULL,
      forkedByGaii      TEXT NOT NULL,
      forkedAt          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_forks_source ON app_forks(sourceOwnerGaii, sourceFilename);
    CREATE INDEX IF NOT EXISTS idx_app_forks_child ON app_forks(childOwnerGaii, childFilename);

    -- ── Subdomain Sites (operator-managed subdomain → app/redirect mappings) ──
    CREATE TABLE IF NOT EXISTS subdomain_sites (
      subdomain  TEXT PRIMARY KEY,
      kind       TEXT NOT NULL CHECK (kind IN ('app','redirect')),
      target     TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      createdBy  TEXT NOT NULL,
      createdAt  TEXT NOT NULL,
      updatedAt  TEXT NOT NULL
    );

    -- ── App Grants (owner-issued app authorizations → agent tokens) ──
    CREATE TABLE IF NOT EXISTS app_grants (
      grantId          TEXT PRIMARY KEY,
      app              TEXT NOT NULL,
      appName          TEXT NOT NULL,
      appOrigin        TEXT NOT NULL,
      owner            TEXT NOT NULL,
      gaii             TEXT NOT NULL,
      scopes           TEXT NOT NULL DEFAULT '[]',
      refreshTokenHash TEXT,
      createdAt        TEXT NOT NULL,
      lastUsedAt       TEXT,
      revoked          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_app_grants_owner ON app_grants(owner);
    CREATE INDEX IF NOT EXISTS idx_app_grants_refreshTokenHash ON app_grants(refreshTokenHash);

    -- ── App Marketplace Purchases (immutable receipts) ──
    CREATE TABLE IF NOT EXISTS app_purchases (
      transactionId           TEXT PRIMARY KEY,
      buyerGaii               TEXT NOT NULL,
      buyerOwner              TEXT NOT NULL,
      sellerGaii              TEXT NOT NULL,
      sellerOwner             TEXT NOT NULL,
      appFilename             TEXT NOT NULL,
      appName                 TEXT NOT NULL,
      appVersionNumber        INTEGER NOT NULL,
      licenseType             TEXT NOT NULL DEFAULT 'single',
      priceMorsels            INTEGER NOT NULL,
      transactionFeeMorsels   INTEGER NOT NULL DEFAULT 0,
      purchasedAt             TEXT NOT NULL,
      appContent              TEXT NOT NULL,
      appManifest             TEXT NOT NULL DEFAULT '{}',
      appScreenshot           TEXT,
      signature               TEXT NOT NULL,
      nodeId                  TEXT NOT NULL,
      nodePublicKey           TEXT NOT NULL
    );

    -- ── System Settings (config persistence) ──
    CREATE TABLE IF NOT EXISTS system_settings (
      key            TEXT PRIMARY KEY,
      value          TEXT NOT NULL,
      createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════
    -- Indexes
    -- ═══════════════════════════════════════════════════════

    CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
    CREATE INDEX IF NOT EXISTS idx_memory_ownerGaii ON memory(ownerGaii);
    CREATE INDEX IF NOT EXISTS idx_actions_providerGaii ON actions(providerGaii);
    CREATE INDEX IF NOT EXISTS idx_work_providerGaii ON work(providerGaii);
    CREATE INDEX IF NOT EXISTS idx_work_requesterGaii ON work(requesterGaii);
    CREATE INDEX IF NOT EXISTS idx_transactions_gaii ON wallet_transactions(gaii);
    CREATE INDEX IF NOT EXISTS idx_posts_boardId ON board_posts(boardId);
    CREATE INDEX IF NOT EXISTS idx_subs_boardId ON board_subscriptions(boardId);
    CREATE INDEX IF NOT EXISTS idx_subs_gaii ON board_subscriptions(gaii);
    CREATE INDEX IF NOT EXISTS idx_otks_sessionId ON otks(sessionId);
    CREATE INDEX IF NOT EXISTS idx_disputes_trackingCode ON disputes(trackingCode);
    CREATE INDEX IF NOT EXISTS idx_micro_memory_gaii ON micro_memory(gaii);
    CREATE INDEX IF NOT EXISTS idx_storage_files_ownerGaii ON storage_files(ownerGaii);
    CREATE INDEX IF NOT EXISTS idx_ghii_ownerName ON ghiis(ownerName);
    CREATE INDEX IF NOT EXISTS idx_ghii_emailHash ON ghiis(emailHash);
    -- idx_ghii_googleSub is created AFTER the safeAddColumn migration below, so the
    -- column exists on upgraded databases before it is indexed (see note there).
    CREATE INDEX IF NOT EXISTS idx_chat_ownerName ON chat_instances(ownerName);
    CREATE INDEX IF NOT EXISTS idx_email_ver_ownerName ON email_verifications(ownerName);
    CREATE INDEX IF NOT EXISTS idx_personal_ownerName ON personal_nodes(ownerName);
    CREATE INDEX IF NOT EXISTS idx_mailbox_nodeId ON mailbox_items(personalNodeId);
    CREATE INDEX IF NOT EXISTS idx_consents_ownerGaii ON consents(ownerGaii);
    CREATE INDEX IF NOT EXISTS idx_consent_audit_ownerGaii ON consent_audit(ownerGaii);
    CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(targetType, targetId);
    CREATE INDEX IF NOT EXISTS idx_matches_profileA ON matches(profileA);
    CREATE INDEX IF NOT EXISTS idx_matches_profileB ON matches(profileB);
    CREATE INDEX IF NOT EXISTS idx_memberships_organismId ON organism_memberships(organismId);
    CREATE INDEX IF NOT EXISTS idx_memberships_ghii ON organism_memberships(ghii);
    CREATE INDEX IF NOT EXISTS idx_join_requests_organismId ON join_requests(organismId);
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_organismId ON pending_approvals(organismId);
    CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(organismId, status);
    CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
    CREATE INDEX IF NOT EXISTS idx_purchases_buyerOwner ON purchases(buyerOwner);
    CREATE INDEX IF NOT EXISTS idx_purchases_sellerOwner ON purchases(sellerOwner);
    CREATE INDEX IF NOT EXISTS idx_genesis_nodeId ON genesis_peers(genesisNodeId);
    CREATE INDEX IF NOT EXISTS idx_escrow_fromGaii ON escrow_holds(fromGaii);
    CREATE INDEX IF NOT EXISTS idx_pps_nodeId ON personal_push_subscriptions(personalNodeId);
    CREATE INDEX IF NOT EXISTS idx_pps_ownerName ON personal_push_subscriptions(ownerName);
    CREATE INDEX IF NOT EXISTS idx_revoked_expires ON revoked_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_apps_ownerName ON apps(ownerName);
    CREATE INDEX IF NOT EXISTS idx_apps_filename ON apps(filename);
    CREATE INDEX IF NOT EXISTS idx_app_purchases_buyer ON app_purchases(buyerGaii);
    CREATE INDEX IF NOT EXISTS idx_app_purchases_seller ON app_purchases(sellerGaii);
    CREATE INDEX IF NOT EXISTS idx_app_purchases_app ON app_purchases(sellerGaii, appFilename);

    -- ── Knowledge System: Memory Links ──
    CREATE TABLE IF NOT EXISTS knowledge_links (
      source      TEXT NOT NULL,
      target      TEXT NOT NULL,
      relation    TEXT NOT NULL,
      description TEXT NOT NULL,
      linked_at   TEXT NOT NULL,
      linked_by   TEXT NOT NULL,
      PRIMARY KEY (source, target)
    );
    CREATE INDEX IF NOT EXISTS idx_klinks_source ON knowledge_links(source);
    CREATE INDEX IF NOT EXISTS idx_klinks_target ON knowledge_links(target);
    CREATE INDEX IF NOT EXISTS idx_klinks_linked_by ON knowledge_links(linked_by);

    -- ── Knowledge System: Operator Reviews ──
    CREATE TABLE IF NOT EXISTS knowledge_reviews (
      id             TEXT PRIMARY KEY,
      packageId      TEXT NOT NULL,
      operatorGaii   TEXT NOT NULL,
      reason         TEXT NOT NULL,
      customText     TEXT,
      action         TEXT NOT NULL,
      timestamp      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kreviews_package ON knowledge_reviews(packageId);
    CREATE INDEX IF NOT EXISTS idx_kreviews_timestamp ON knowledge_reviews(timestamp);

    -- ── Scheduled Jobs ──
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'core',
      extensionName   TEXT,
      instanceId      TEXT,
      actionId        TEXT,
      coreHandler     TEXT,
      cron            TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      input           TEXT,
      lastRunAt       TEXT,
      lastRunResult   TEXT,
      lastRunError    TEXT,
      lastRunDurationMs INTEGER,
      nextRunAt       TEXT,
      createdBy       TEXT NOT NULL,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL,
      -- Agent-scheduler additions (additive / nullable)
      ownerScope      TEXT,
      agentName       TEXT,
      agentGaii       TEXT,
      createdByAgent  INTEGER NOT NULL DEFAULT 0,
      displayName     TEXT,
      description     TEXT,
      purpose         TEXT,
      timezone        TEXT,
      constraints     TEXT,
      runCount        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS execution_log (
      id              TEXT PRIMARY KEY,
      jobId           TEXT NOT NULL,
      jobName         TEXT NOT NULL,
      type            TEXT NOT NULL,
      extensionName   TEXT,
      actionId        TEXT,
      "trigger"       TEXT NOT NULL,
      result          TEXT NOT NULL,
      errorMessage    TEXT,
      durationMs      INTEGER NOT NULL DEFAULT 0,
      memoryReads     TEXT NOT NULL DEFAULT '[]',
      memoryWrites    TEXT NOT NULL DEFAULT '[]',
      taskId          TEXT,
      createdAt       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_execution_log_jobId ON execution_log(jobId);
    CREATE INDEX IF NOT EXISTS idx_execution_log_createdAt ON execution_log(createdAt);
    CREATE INDEX IF NOT EXISTS idx_execution_log_extensionName ON execution_log(extensionName);

    -- ── Federation Peers (persisted active peer connections) ──
    CREATE TABLE IF NOT EXISTS federation_peers (
      nodeId          TEXT PRIMARY KEY,
      url             TEXT NOT NULL,
      publicKey       TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending',
      addedAt         TEXT NOT NULL,
      lastSeen        TEXT NOT NULL
    );

    -- ── Replication Queue (B.1) ──
    CREATE TABLE IF NOT EXISTS replication_queue (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      targetPeers     TEXT NOT NULL DEFAULT '[]',
      payload         TEXT,
      createdAt       TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      lastAttemptAt   TEXT,
      status          TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_repq_status ON replication_queue(status);
    CREATE INDEX IF NOT EXISTS idx_repq_createdAt ON replication_queue(createdAt);

    CREATE TABLE IF NOT EXISTS extension_instances (
      id              TEXT NOT NULL,
      extensionName   TEXT NOT NULL,
      config          TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'active',
      createdBy       TEXT NOT NULL,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL,
      PRIMARY KEY (extensionName, id)
    );

    -- ── Device Authorization (RFC 8628) ──
    CREATE TABLE IF NOT EXISTS device_auth (
      deviceCode    TEXT PRIMARY KEY,
      userCode      TEXT NOT NULL UNIQUE,
      ownerName     TEXT NOT NULL,
      agentName     TEXT NOT NULL,
      displayName   TEXT,
      description   TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      scopes        TEXT,
      createdAt     TEXT NOT NULL,
      expiresAt     TEXT NOT NULL,
      lastPolledAt  TEXT,
      pollInterval  INTEGER NOT NULL DEFAULT 5,
      approvedBy    TEXT,
      agentCredentials TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_device_auth_userCode ON device_auth(userCode);
    CREATE INDEX IF NOT EXISTS idx_device_auth_ownerName ON device_auth(ownerName);
    CREATE INDEX IF NOT EXISTS idx_device_auth_status ON device_auth(status);

    -- ── Ecosystem Applications (GEAI principal) ──
    -- Mirror of the agents table, minus task/agent-only fields, plus the ecosystem binding fields.
    CREATE TABLE IF NOT EXISTS ecosystem_apps (
      geai          TEXT PRIMARY KEY,
      app           TEXT NOT NULL,
      owner         TEXT NOT NULL,
      displayName   TEXT,
      description   TEXT,
      publicKey     TEXT NOT NULL,
      scopes        TEXT NOT NULL DEFAULT '[]',
      dataAreas     TEXT,
      boundRef      TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      morselBalance REAL NOT NULL DEFAULT 0,
      capabilities  TEXT,
      automation    TEXT,
      setup         TEXT,
      createdAt     TEXT NOT NULL,
      lastSeen      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ecosystem_apps_owner ON ecosystem_apps(owner);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ecosystem_apps_owner_app ON ecosystem_apps(owner, app);

    -- ── Ecosystem "hello integration" handshake (RFC 8628 analog) ──
    CREATE TABLE IF NOT EXISTS eco_auth (
      deviceCode    TEXT PRIMARY KEY,
      userCode      TEXT NOT NULL UNIQUE,
      ownerName     TEXT NOT NULL,
      app           TEXT NOT NULL,
      displayName   TEXT,
      description   TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      publicKey     TEXT,
      scopes        TEXT,
      dataAreas     TEXT,
      boundRef      TEXT,
      createdAt     TEXT NOT NULL,
      expiresAt     TEXT NOT NULL,
      lastPolledAt  TEXT,
      pollInterval  INTEGER NOT NULL DEFAULT 5,
      approvedBy    TEXT,
      validationResult TEXT,
      capabilities  TEXT,
      automation    TEXT,
      setup         TEXT,
      appCredentials TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_eco_auth_userCode ON eco_auth(userCode);
    CREATE INDEX IF NOT EXISTS idx_eco_auth_ownerName ON eco_auth(ownerName);
    CREATE INDEX IF NOT EXISTS idx_eco_auth_status ON eco_auth(status);

    -- ── Ecosystem-app automation recipes (feature B4) ──
    -- One rule per (owner, app): when the app publishes data on a memory key matching
    -- trigger.keyGlob, materialise an agent task for each agent in the agents list. The downstream
    -- columns (organism/email/requireApproval) are STORED ONLY in B4 (enforced later: B5/B6/B7).
    CREATE TABLE IF NOT EXISTS eco_automation_recipes (
      id              TEXT PRIMARY KEY,
      owner           TEXT NOT NULL,
      app             TEXT NOT NULL,
      trigger         TEXT NOT NULL,            -- JSON: { kind, keyGlob }
      agents          TEXT NOT NULL DEFAULT '[]', -- JSON: string[] of agent names
      organism        TEXT,
      email           INTEGER NOT NULL DEFAULT 0,
      requireApproval INTEGER NOT NULL DEFAULT 0,
      enabled         INTEGER NOT NULL DEFAULT 1,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eco_automation_recipes_owner ON eco_automation_recipes(owner);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_eco_automation_recipes_owner_app ON eco_automation_recipes(owner, app);
  `);
}
