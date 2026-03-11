import type Database from 'better-sqlite3';

/**
 * Initialize the SQLite database schema for all AIMEAT storage entities.
 * Creates tables and indexes using IF NOT EXISTS for idempotent initialization.
 */
export function initializeSchema(db: Database.Database): void {
  db.exec(`

    -- ── Owners ──
    CREATE TABLE IF NOT EXISTS owners (
      name           TEXT PRIMARY KEY,
      displayName    TEXT,
      publicKey      TEXT NOT NULL,
      roles          TEXT NOT NULL DEFAULT '[]',
      createdAt      TEXT NOT NULL
    );

    -- ── Agents ──
    CREATE TABLE IF NOT EXISTS agents (
      gaii           TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      owner          TEXT NOT NULL,
      displayName    TEXT,
      description    TEXT,
      capabilities   TEXT NOT NULL DEFAULT '[]',
      publicKey      TEXT NOT NULL,
      trustScore     REAL NOT NULL DEFAULT 50,
      morselBalance  REAL NOT NULL DEFAULT 0,
      createdAt      TEXT NOT NULL,
      lastSeen       TEXT NOT NULL,
      semantic       TEXT,
      allowedOrigins TEXT
    );

    -- ── Memory ──
    CREATE TABLE IF NOT EXISTS memory (
      ownerGaii      TEXT NOT NULL,
      key            TEXT NOT NULL,
      value          TEXT,
      visibility     TEXT NOT NULL DEFAULT 'private',
      tags           TEXT NOT NULL DEFAULT '[]',
      ttlHours       REAL,
      version        INTEGER NOT NULL DEFAULT 1,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      flagCount      INTEGER DEFAULT 0,
      allowedOrigins TEXT,
      PRIMARY KEY (ownerGaii, key)
    );

    -- ── Actions ──
    CREATE TABLE IF NOT EXISTS actions (
      providerGaii       TEXT NOT NULL,
      id                 TEXT NOT NULL,
      displayName        TEXT NOT NULL,
      description        TEXT NOT NULL,
      category           TEXT,
      inputSchema        TEXT NOT NULL DEFAULT '{}',
      outputSchema       TEXT NOT NULL DEFAULT '{}',
      pricing            TEXT NOT NULL DEFAULT '{}',
      estimatedTimeSeconds INTEGER,
      maxInputSizeBytes  INTEGER,
      tags               TEXT NOT NULL DEFAULT '[]',
      webhookUrl         TEXT,
      createdAt          TEXT NOT NULL,
      updatedAt          TEXT NOT NULL,
      semantic           TEXT,
      PRIMARY KEY (providerGaii, id)
    );

    -- ── Work ──
    CREATE TABLE IF NOT EXISTS work (
      trackingCode   TEXT PRIMARY KEY,
      status         TEXT NOT NULL,
      actionId       TEXT NOT NULL,
      providerGaii   TEXT NOT NULL,
      requesterGaii  TEXT NOT NULL,
      input          TEXT NOT NULL DEFAULT '{}',
      output         TEXT,
      cost           TEXT NOT NULL DEFAULT '{}',
      ttlExpiresAt   TEXT NOT NULL,
      callbackUrl    TEXT,
      rating         TEXT,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL
    );

    -- ── Wallet Transactions ──
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id               TEXT PRIMARY KEY,
      gaii             TEXT NOT NULL,
      type             TEXT NOT NULL,
      amount           REAL NOT NULL,
      counterpartyGaii TEXT,
      trackingCode     TEXT,
      timestamp        TEXT NOT NULL
    );

    -- ── Boards ──
    CREATE TABLE IF NOT EXISTS boards (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      description    TEXT,
      visibility     TEXT NOT NULL DEFAULT 'public',
      ownerGaii      TEXT NOT NULL,
      allowedGaiis   TEXT NOT NULL DEFAULT '[]',
      createdAt      TEXT NOT NULL,
      semantic       TEXT
    );

    -- ── Board Posts ──
    CREATE TABLE IF NOT EXISTS board_posts (
      boardId        TEXT NOT NULL,
      id             TEXT NOT NULL,
      authorGaii     TEXT NOT NULL,
      title          TEXT NOT NULL,
      body           TEXT NOT NULL,
      category       TEXT,
      tags           TEXT NOT NULL DEFAULT '[]',
      ttlExpiresAt   TEXT,
      reactions      TEXT NOT NULL DEFAULT '{}',
      replyTo        TEXT,
      createdAt      TEXT NOT NULL,
      semantic       TEXT,
      PRIMARY KEY (boardId, id)
    );

    -- ── Board Subscriptions ──
    CREATE TABLE IF NOT EXISTS board_subscriptions (
      id             TEXT PRIMARY KEY,
      boardId        TEXT NOT NULL,
      gaii           TEXT NOT NULL,
      callbackUrl    TEXT,
      filters        TEXT,
      createdAt      TEXT NOT NULL
    );

    -- ── One-Time Keys ──
    CREATE TABLE IF NOT EXISTS otks (
      key            TEXT PRIMARY KEY,
      ownerGaii      TEXT NOT NULL,
      action         TEXT NOT NULL,
      params         TEXT NOT NULL DEFAULT '{}',
      expiresAt      TEXT NOT NULL,
      initial        INTEGER NOT NULL DEFAULT 0,
      used           INTEGER NOT NULL DEFAULT 0,
      usedAt         TEXT,
      sessionId      TEXT,
      createdAt      TEXT NOT NULL
    );

    -- ── Disputes ──
    CREATE TABLE IF NOT EXISTS disputes (
      id             TEXT PRIMARY KEY,
      trackingCode   TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'open',
      openedBy       TEXT NOT NULL,
      reason         TEXT NOT NULL,
      ruling         TEXT,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL
    );

    -- ── Dispute Audit ──
    CREATE TABLE IF NOT EXISTS dispute_audit (
      disputeId      TEXT NOT NULL,
      sequence       INTEGER NOT NULL,
      event          TEXT NOT NULL,
      actor          TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      data           TEXT NOT NULL DEFAULT '{}',
      hash           TEXT NOT NULL,
      previousHash   TEXT NOT NULL,
      PRIMARY KEY (disputeId, sequence)
    );

    -- ── Micro Memory ──
    CREATE TABLE IF NOT EXISTS micro_memory (
      gaii           TEXT NOT NULL,
      setName        TEXT NOT NULL,
      entries        TEXT NOT NULL DEFAULT '{}',
      visibility     TEXT NOT NULL DEFAULT 'private',
      accessCode     TEXT,
      updatedAt      TEXT NOT NULL,
      PRIMARY KEY (gaii, setName)
    );

    -- ── Storage Files ──
    CREATE TABLE IF NOT EXISTS storage_files (
      ownerGaii      TEXT NOT NULL,
      key            TEXT NOT NULL,
      visibility     TEXT NOT NULL DEFAULT 'private',
      mimeType       TEXT NOT NULL,
      size           INTEGER NOT NULL DEFAULT 0,
      data           BLOB,
      accessCode     TEXT,
      tags           TEXT NOT NULL DEFAULT '[]',
      createdAt      TEXT NOT NULL,
      PRIMARY KEY (ownerGaii, key)
    );

    -- ── Peering Requests ──
    CREATE TABLE IF NOT EXISTS peering_requests (
      id             TEXT PRIMARY KEY,
      fromNodeUrl    TEXT NOT NULL,
      fromNodeId     TEXT,
      toNodeId       TEXT,
      targetUrl      TEXT,
      publicKey      TEXT,
      message        TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL
    );

    -- ── GHII (Global Human Identity Identifier) ──
    CREATE TABLE IF NOT EXISTS ghiis (
      ghii                       TEXT PRIMARY KEY,
      username                   TEXT NOT NULL,
      nodeId                     TEXT NOT NULL,
      displayName                TEXT NOT NULL,
      bio                        TEXT,
      avatar                     TEXT,
      locale                     TEXT,
      passwordHash               TEXT,
      verificationLevel          INTEGER NOT NULL DEFAULT 0,
      ownerName                  TEXT NOT NULL,
      createdAt                  TEXT NOT NULL,
      updatedAt                  TEXT NOT NULL,
      totpSecret                 TEXT,
      totpEnabled                INTEGER NOT NULL DEFAULT 0,
      totpBackupCodes            TEXT,
      totpLastUsedAt             TEXT,
      totpLastUsedCode           TEXT,
      totpFailedAttempts         INTEGER DEFAULT 0,
      totpLockedUntil            TEXT,
      semantic                   TEXT,
      emailHash                  TEXT,
      emailVerifiedAt            TEXT,
      verificationMethod         TEXT,
      magicLinkEnabled           INTEGER DEFAULT 0,
      notificationEmail          TEXT,
      lastLoginAt                TEXT,
      loginCount                 INTEGER DEFAULT 0,
      verifiedAttributes         TEXT,
      verificationIssuer         TEXT,
      verificationCredentialHash TEXT,
      ftnVerified                INTEGER DEFAULT 0,
      trustScore                 REAL,
      morselBalance              REAL,
      allowedOrigins             TEXT
    );

    -- ── Chat Instances ──
    CREATE TABLE IF NOT EXISTS chat_instances (
      id             TEXT PRIMARY KEY,
      platform       TEXT NOT NULL,
      appName        TEXT NOT NULL,
      ownerName      TEXT NOT NULL,
      ghii           TEXT NOT NULL,
      nodeId         TEXT NOT NULL,
      isAnonymous    INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT NOT NULL,
      lastSeen       TEXT NOT NULL,
      agentGaii      TEXT,
      mcpClientId    TEXT
    );

    -- ── Email Verifications ──
    CREATE TABLE IF NOT EXISTS email_verifications (
      id             TEXT PRIMARY KEY,
      ownerName      TEXT NOT NULL,
      emailHash      TEXT NOT NULL,
      code           TEXT NOT NULL,
      purpose        TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      attempts       INTEGER NOT NULL DEFAULT 0,
      expiresAt      TEXT NOT NULL,
      createdAt      TEXT NOT NULL,
      verifiedAt     TEXT
    );

    -- ── Personal Nodes ──
    CREATE TABLE IF NOT EXISTS personal_nodes (
      nodeId             TEXT PRIMARY KEY,
      ownerName          TEXT NOT NULL,
      anchorNodeId       TEXT NOT NULL,
      publicKey          TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'offline',
      agentGaiis         TEXT NOT NULL DEFAULT '[]',
      lastSeen           TEXT NOT NULL,
      mailboxQuotaBytes  INTEGER NOT NULL DEFAULT 0,
      mailboxUsedBytes   INTEGER NOT NULL DEFAULT 0,
      visibility         TEXT NOT NULL DEFAULT 'private',
      createdAt          TEXT NOT NULL,
      updatedAt          TEXT NOT NULL,
      semantic           TEXT
    );

    -- ── Mailbox Items ──
    CREATE TABLE IF NOT EXISTS mailbox_items (
      id              TEXT PRIMARY KEY,
      personalNodeId  TEXT NOT NULL,
      type            TEXT NOT NULL,
      fromGaii        TEXT NOT NULL,
      toGaii          TEXT NOT NULL,
      payload         TEXT NOT NULL,
      sizeBytes       INTEGER NOT NULL DEFAULT 0,
      retentionDays   INTEGER NOT NULL DEFAULT 7,
      expiresAt       TEXT NOT NULL,
      createdAt       TEXT NOT NULL
    );

    -- ── Schemas (Schema Locking) ──
    CREATE TABLE IF NOT EXISTS schemas (
      keyPattern       TEXT NOT NULL,
      applyTo          TEXT NOT NULL DEFAULT 'exact',
      schemaJson       TEXT NOT NULL DEFAULT '{}',
      schemaMode       TEXT NOT NULL DEFAULT 'open',
      lockedBy         TEXT NOT NULL,
      setAt            TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      semanticContext   TEXT,
      PRIMARY KEY (keyPattern, applyTo)
    );

    -- ── Consents ──
    CREATE TABLE IF NOT EXISTS consents (
      id             TEXT PRIMARY KEY,
      ownerGaii      TEXT NOT NULL,
      dataPattern    TEXT NOT NULL,
      recipient      TEXT NOT NULL,
      purpose        TEXT NOT NULL,
      scope          TEXT NOT NULL DEFAULT 'private',
      expires        TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      grantedAt      TEXT NOT NULL,
      revokedAt      TEXT,
      metadata       TEXT
    );

    -- ── Consent Audit ──
    CREATE TABLE IF NOT EXISTS consent_audit (
      id             TEXT PRIMARY KEY,
      consentId      TEXT NOT NULL,
      ownerGaii      TEXT NOT NULL,
      accessorGaii   TEXT NOT NULL,
      memoryKey      TEXT NOT NULL,
      action         TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      allowed        INTEGER NOT NULL DEFAULT 1
    );

    -- ── CSMs (Community Service Manifests) ──
    CREATE TABLE IF NOT EXISTS csms (
      name           TEXT PRIMARY KEY,
      definition     TEXT NOT NULL DEFAULT '{}',
      jsonSchemaKey  TEXT NOT NULL,
      serviceType    TEXT NOT NULL,
      registeredBy   TEXT NOT NULL,
      registeredAt   TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      semantic       TEXT,
      federate       INTEGER DEFAULT 0
    );

    -- ── MSMs (Machine Service Manifests) ──
    CREATE TABLE IF NOT EXISTS msms (
      name           TEXT PRIMARY KEY,
      definition     TEXT NOT NULL DEFAULT '{}',
      category       TEXT NOT NULL,
      authType       TEXT NOT NULL,
      actionsCount   INTEGER NOT NULL DEFAULT 0,
      registeredBy   TEXT NOT NULL,
      registeredAt   TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      federate       INTEGER DEFAULT 0
    );

    -- ── Flags ──
    CREATE TABLE IF NOT EXISTS flags (
      id             TEXT PRIMARY KEY,
      targetType     TEXT NOT NULL,
      targetId       TEXT NOT NULL,
      flaggedBy      TEXT NOT NULL,
      reason         TEXT NOT NULL,
      description    TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      reviewedBy     TEXT,
      reviewedAt     TEXT,
      createdAt      TEXT NOT NULL
    );

    -- ── Appeals (Advanced Moderation) ──
    CREATE TABLE IF NOT EXISTS appeals (
      id             TEXT PRIMARY KEY,
      flagId         TEXT NOT NULL,
      appealedBy     TEXT NOT NULL,
      reason         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      reviewedBy     TEXT,
      reviewNote     TEXT,
      createdAt      TEXT NOT NULL,
      reviewedAt     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_appeals_flagId ON appeals(flagId);

    -- ── Matches ──
    CREATE TABLE IF NOT EXISTS matches (
      id             TEXT PRIMARY KEY,
      profileA       TEXT NOT NULL,
      profileB       TEXT NOT NULL,
      score          REAL NOT NULL DEFAULT 0,
      breakdown      TEXT NOT NULL DEFAULT '{}',
      status         TEXT NOT NULL DEFAULT 'suggested',
      notifiedAt     TEXT,
      respondedAt    TEXT,
      expiresAt      TEXT NOT NULL,
      createdAt      TEXT NOT NULL
    );

    -- ── Organisms ──
    CREATE TABLE IF NOT EXISTS organisms (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL,
      type             TEXT NOT NULL,
      location         TEXT,
      interests        TEXT NOT NULL DEFAULT '[]',
      creatorGhii      TEXT NOT NULL,
      admins           TEXT NOT NULL DEFAULT '[]',
      members          TEXT NOT NULL DEFAULT '[]',
      agentGaiis       TEXT NOT NULL DEFAULT '[]',
      boardId          TEXT NOT NULL,
      joinPolicy       TEXT NOT NULL DEFAULT 'open',
      maxMembers       INTEGER NOT NULL DEFAULT 100,
      visibility       TEXT NOT NULL DEFAULT 'public',
      moderationConfig TEXT NOT NULL DEFAULT '{}',
      memoryNamespace  TEXT NOT NULL,
      semantic         TEXT,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL
    );

    -- ── Organism Memberships ──
    CREATE TABLE IF NOT EXISTS organism_memberships (
      id             TEXT PRIMARY KEY,
      organismId     TEXT NOT NULL,
      ghii           TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'member',
      status         TEXT NOT NULL DEFAULT 'active',
      joinedAt       TEXT NOT NULL,
      invitedBy      TEXT
    );

    -- ── Join Requests ──
    CREATE TABLE IF NOT EXISTS join_requests (
      id             TEXT PRIMARY KEY,
      organismId     TEXT NOT NULL,
      ghii           TEXT NOT NULL,
      message        TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      reviewedBy     TEXT,
      createdAt      TEXT NOT NULL,
      reviewedAt     TEXT
    );

    -- ── Listings (Marketplace) ──
    CREATE TABLE IF NOT EXISTS listings (
      id             TEXT PRIMARY KEY,
      ownerName      TEXT NOT NULL,
      sellerGhii     TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT NOT NULL,
      category       TEXT NOT NULL,
      priceMorsels   REAL NOT NULL DEFAULT 0,
      condition      TEXT,
      availability   TEXT,
      location       TEXT,
      tags           TEXT,
      images         TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      memoryKey      TEXT NOT NULL,
      flagCount      INTEGER NOT NULL DEFAULT 0,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      semantic       TEXT
    );

    -- ── Purchases ──
    CREATE TABLE IF NOT EXISTS purchases (
      id                    TEXT PRIMARY KEY,
      listingId             TEXT NOT NULL,
      buyerOwner            TEXT NOT NULL,
      sellerOwner           TEXT NOT NULL,
      priceMorsels          REAL NOT NULL DEFAULT 0,
      transactionFeeMorsels REAL NOT NULL DEFAULT 0,
      totalCostMorsels      REAL NOT NULL DEFAULT 0,
      status                TEXT NOT NULL DEFAULT 'pending_delivery',
      rating                TEXT,
      trackingCode          TEXT NOT NULL,
      createdAt             TEXT NOT NULL,
      completedAt           TEXT
    );

    -- ── Push Subscriptions ──
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      ownerName      TEXT PRIMARY KEY,
      endpoint       TEXT NOT NULL,
      keys           TEXT NOT NULL DEFAULT '{}',
      createdAt      TEXT NOT NULL,
      lastUsedAt     TEXT NOT NULL
    );

    -- ── Trusted Issuers ──
    CREATE TABLE IF NOT EXISTS trusted_issuers (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      url            TEXT NOT NULL,
      publicKey      TEXT NOT NULL,
      type           TEXT NOT NULL,
      trusted        INTEGER NOT NULL DEFAULT 1,
      addedBy        TEXT NOT NULL,
      createdAt      TEXT NOT NULL
    );

    -- ── Genesis Peers ──
    CREATE TABLE IF NOT EXISTS genesis_peers (
      id              TEXT PRIMARY KEY,
      genesisNodeId   TEXT NOT NULL,
      genesisUrl      TEXT NOT NULL,
      publicKey       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      lastSyncAt      TEXT NOT NULL,
      catalogueHash   TEXT NOT NULL,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL
    );

    -- ── Organism Reputations ──
    CREATE TABLE IF NOT EXISTS organism_reputations (
      organismId     TEXT PRIMARY KEY,
      score          REAL NOT NULL DEFAULT 0,
      breakdown      TEXT NOT NULL DEFAULT '{}',
      calculatedAt   TEXT NOT NULL
    );

    -- ── Realtime Rooms ──
    CREATE TABLE IF NOT EXISTS realtime_rooms (
      id              TEXT PRIMARY KEY,
      appType         TEXT NOT NULL,
      name            TEXT NOT NULL,
      createdBy       TEXT NOT NULL,
      maxPeers        INTEGER NOT NULL DEFAULT 10,
      isPublic        INTEGER NOT NULL DEFAULT 1,
      tags            TEXT NOT NULL DEFAULT '[]',
      peerCount       INTEGER NOT NULL DEFAULT 0,
      createdAt       TEXT NOT NULL,
      lastActivityAt  TEXT NOT NULL
    );

    -- ── Site Change Log ──
    CREATE TABLE IF NOT EXISTS site_changelog (
      id             TEXT PRIMARY KEY,
      action         TEXT NOT NULL,
      summary        TEXT NOT NULL,
      changedBy      TEXT NOT NULL,
      changedAt      TEXT NOT NULL
    );

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
      sessionId      TEXT PRIMARY KEY,
      gaii           TEXT NOT NULL,
      owner          TEXT NOT NULL,
      issuedAt       TEXT NOT NULL,
      expiresAt      TEXT NOT NULL,
      revoked        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner);
    CREATE INDEX IF NOT EXISTS idx_sessions_gaii ON sessions(gaii);

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
      createdAt      TEXT NOT NULL,
      PRIMARY KEY (ownerGaii, filename, versionNumber)
    );

    CREATE TABLE IF NOT EXISTS app_downloads (
      ownerGaii      TEXT NOT NULL,
      filename       TEXT NOT NULL,
      downloads      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ownerGaii, filename)
    );

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
      updatedAt       TEXT NOT NULL
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

    -- ── OAuth 2.1 Persistent State ──
    CREATE TABLE IF NOT EXISTS oauth_clients (
      clientId      TEXT PRIMARY KEY,
      clientSecret  TEXT NOT NULL,
      clientName    TEXT NOT NULL,
      redirectUris  TEXT NOT NULL DEFAULT '[]',
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      tokenHash     TEXT PRIMARY KEY,
      clientId      TEXT NOT NULL,
      gaii          TEXT NOT NULL,
      owner         TEXT NOT NULL,
      roles         TEXT NOT NULL DEFAULT '[]',
      createdAt     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_clientId ON oauth_refresh_tokens(clientId);
    CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_gaii ON oauth_refresh_tokens(gaii);

    CREATE TABLE IF NOT EXISTS oauth_approvals (
      clientId      TEXT NOT NULL,
      gaii          TEXT NOT NULL,
      owner         TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'aimeat:full',
      approvedAt    TEXT NOT NULL,
      PRIMARY KEY (clientId, gaii)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_approvals_gaii ON oauth_approvals(gaii);
    CREATE INDEX IF NOT EXISTS idx_oauth_approvals_owner ON oauth_approvals(owner);

  `);

  // ── Schema migrations for existing databases ──
  // ALTER TABLE ADD COLUMN is idempotent-safe: if the column exists, it throws
  // "duplicate column name" which we catch and ignore.
  const safeAddColumn = (table: string, column: string, type: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* column already exists */ }
  };

  // Phase 2 CORS — GHII-level allowed origins
  safeAddColumn('ghiis', 'allowedOrigins', 'TEXT');

  // Phase 3 CORS — Agent-level allowed origins
  safeAddColumn('agents', 'allowedOrigins', 'TEXT');

  // Phase 4 CORS — Memory-level allowed origins
  safeAddColumn('memory', 'allowedOrigins', 'TEXT');

  // MCP session tracking — agent and OAuth client binding
  safeAddColumn('chat_instances', 'agentGaii', 'TEXT');
  safeAddColumn('chat_instances', 'mcpClientId', 'TEXT');
}
