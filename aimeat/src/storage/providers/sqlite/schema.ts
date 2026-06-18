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
      dailySpendLimit REAL DEFAULT NULL,
      maxConcurrentTasks INTEGER NOT NULL DEFAULT 1,
      createdAt      TEXT NOT NULL,
      lastSeen       TEXT NOT NULL,
      semantic       TEXT,
      allowedOrigins TEXT,
      defaultScopes  TEXT,
      webhookUrl         TEXT,
      webhookSecret      TEXT,
      webhookEnabled     INTEGER NOT NULL DEFAULT 0,
      webhookLastSuccess TEXT,
      webhookLastFailure TEXT,
      webhookFailCount   INTEGER NOT NULL DEFAULT 0,
      platform           TEXT,
      platformVersion    TEXT,
      platformDetectedBy TEXT,
      tags               TEXT
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

    -- ── Pending Approvals (Phase 4 — Gate primitive) ──
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id             TEXT PRIMARY KEY,
      organismId     TEXT NOT NULL,
      flowGateId     TEXT,
      stageId        TEXT,
      actor          TEXT NOT NULL,
      action         TEXT NOT NULL,
      arguments      TEXT,
      risk           TEXT NOT NULL DEFAULT 'medium',
      approverRole   TEXT NOT NULL DEFAULT 'owner',
      prompt         TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      decidedBy      TEXT,
      decidedAt      TEXT,
      resolutionNote TEXT,
      deadline       TEXT,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL
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

    -- ── Verification Nonces ──
    CREATE TABLE IF NOT EXISTS verification_nonces (
      id             TEXT PRIMARY KEY,
      owner          TEXT NOT NULL,
      type           TEXT NOT NULL,
      state          TEXT NOT NULL UNIQUE,
      nonce          TEXT NOT NULL,
      redirectUri    TEXT NOT NULL DEFAULT '',
      createdAt      TEXT NOT NULL,
      expiresAt      TEXT NOT NULL
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

    -- System Prompts (Phase 4)
    CREATE TABLE IF NOT EXISTS system_prompts (
      id          TEXT PRIMARY KEY,
      grp         TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL,
      locales     TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      variables   TEXT NOT NULL DEFAULT '[]',
      usedIn      TEXT NOT NULL DEFAULT '[]',
      version     INTEGER NOT NULL DEFAULT 1,
      updatedAt   TEXT NOT NULL,
      updatedBy   TEXT NOT NULL DEFAULT 'system'
    );

    CREATE TABLE IF NOT EXISTS system_prompt_versions (
      promptId    TEXT NOT NULL,
      version     INTEGER NOT NULL,
      content     TEXT NOT NULL,
      locales     TEXT,
      changedBy   TEXT NOT NULL,
      changedAt   TEXT NOT NULL,
      changeNote  TEXT,
      PRIMARY KEY (promptId, version)
    );

    -- ── Packages ──
    CREATE TABLE IF NOT EXISTS packages (
      id                TEXT PRIMARY KEY,
      packageGroupId    TEXT NOT NULL,
      name              TEXT NOT NULL,
      author            TEXT NOT NULL,
      authorGhii        TEXT NOT NULL,
      version           TEXT NOT NULL,
      changelog         TEXT DEFAULT '',
      description       TEXT DEFAULT '',
      category          TEXT DEFAULT 'other',
      tags              TEXT NOT NULL DEFAULT '[]',
      visibility        TEXT DEFAULT 'private',
      status            TEXT DEFAULT 'draft',
      components        TEXT NOT NULL,
      manifest          TEXT DEFAULT '',
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT NOT NULL,
      UNIQUE(packageGroupId, version)
    );
    CREATE INDEX IF NOT EXISTS idx_packages_group ON packages(packageGroupId);
    CREATE INDEX IF NOT EXISTS idx_packages_author ON packages(author);
    CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

    -- ── Template Listings ──
    CREATE TABLE IF NOT EXISTS template_listings (
      id                TEXT PRIMARY KEY,
      packageGroupId    TEXT NOT NULL UNIQUE,
      packageName       TEXT NOT NULL,
      packageAuthor     TEXT NOT NULL,
      publishedBy       TEXT NOT NULL,
      publishedByGhii   TEXT NOT NULL,
      title             TEXT NOT NULL,
      description       TEXT DEFAULT '',
      screenshots       TEXT NOT NULL DEFAULT '[]',
      category          TEXT DEFAULT 'other',
      tags              TEXT NOT NULL DEFAULT '[]',
      featured          INTEGER DEFAULT 0,
      installCount      INTEGER DEFAULT 0,
      rating            REAL DEFAULT 0,
      reviewCount       INTEGER DEFAULT 0,
      status            TEXT DEFAULT 'listed',
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT NOT NULL,
      rejectionReason   TEXT,
      reviewedBy        TEXT,
      reviewedAt        TEXT,
      reviewComment     TEXT,
      proposedAt        TEXT,
      proposedBy        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_template_listings_category ON template_listings(category);
    CREATE INDEX IF NOT EXISTS idx_template_listings_featured ON template_listings(featured);
    CREATE INDEX IF NOT EXISTS idx_template_listings_status ON template_listings(status);

    -- ── Template Reviews (separate table — avoids race conditions) ──
    CREATE TABLE IF NOT EXISTS template_reviews (
      id                TEXT PRIMARY KEY,
      listingId         TEXT NOT NULL,
      authorGhii        TEXT NOT NULL,
      authorName        TEXT NOT NULL,
      rating            INTEGER NOT NULL,
      comment           TEXT DEFAULT '',
      createdAt         TEXT NOT NULL,
      UNIQUE(listingId, authorGhii)
    );
    CREATE INDEX IF NOT EXISTS idx_template_reviews_listing ON template_reviews(listingId);

    -- ── Template Discussions (separate table — threaded) ──
    CREATE TABLE IF NOT EXISTS template_discussions (
      id                TEXT PRIMARY KEY,
      listingId         TEXT NOT NULL,
      authorGhii        TEXT NOT NULL,
      authorName        TEXT NOT NULL,
      message           TEXT NOT NULL,
      parentId          TEXT,
      createdAt         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_template_discussions_listing ON template_discussions(listingId);

    -- ── Package Instances ──
    CREATE TABLE IF NOT EXISTS package_instances (
      id                  TEXT PRIMARY KEY,
      packageGroupId      TEXT NOT NULL,
      packageVersion      TEXT NOT NULL,
      packageRecordId     TEXT NOT NULL,
      owner               TEXT NOT NULL,
      ownerGhii           TEXT NOT NULL,
      label               TEXT DEFAULT '',
      installedComponents TEXT NOT NULL,
      status              TEXT DEFAULT 'installed',
      installedAt         TEXT NOT NULL,
      updatedAt           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_package_instances_owner ON package_instances(owner);
    CREATE INDEX IF NOT EXISTS idx_package_instances_package ON package_instances(packageGroupId);

    -- Capabilities
    CREATE TABLE IF NOT EXISTS capabilities (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      summary           TEXT NOT NULL DEFAULT '',
      ownerGhii         TEXT NOT NULL,
      visibility        TEXT NOT NULL DEFAULT 'private',
      scope             TEXT NOT NULL DEFAULT 'local',
      status            TEXT NOT NULL DEFAULT 'draft',
      rejectionReason   TEXT,
      deprecationMessage TEXT,
      replacedBy        TEXT,
      sourceType        TEXT NOT NULL,
      sourceRef         TEXT NOT NULL,
      sourceVersion     TEXT NOT NULL DEFAULT '',
      authRequired      TEXT NOT NULL DEFAULT 'registered',
      callable          INTEGER NOT NULL DEFAULT 0,
      inputSchema       TEXT,
      outputSchema      TEXT,
      exports           TEXT,
      usage             TEXT NOT NULL DEFAULT '',
      whenToUse         TEXT NOT NULL DEFAULT '',
      whenNotToUse      TEXT NOT NULL DEFAULT '',
      examples          TEXT NOT NULL DEFAULT '[]',
      dependencies      TEXT NOT NULL DEFAULT '[]',
      schemaHash        TEXT NOT NULL DEFAULT '',
      webhookUrl        TEXT,
      cost              TEXT,
      trustRequired     REAL,
      trust             TEXT NOT NULL DEFAULT '{"operatorReviewed":false,"reviewedAt":null,"vouchCount":0,"publisherTrustScore":0,"codeAudited":false,"auditNotes":null}',
      redactedFields    TEXT NOT NULL DEFAULT '[]',
      operatorOverride  TEXT,
      stats             TEXT NOT NULL DEFAULT '{"totalInvocations":0,"successCount":0,"errorCount":0,"lastInvokedAt":null,"avgResponseMs":0,"lastError":null}',
      tags              TEXT NOT NULL DEFAULT '[]',
      createdAt         TEXT NOT NULL,
      updatedAt         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_capabilities_owner ON capabilities(ownerGhii);
    CREATE INDEX IF NOT EXISTS idx_capabilities_source ON capabilities(sourceType, sourceRef);
    CREATE INDEX IF NOT EXISTS idx_capabilities_status ON capabilities(status);
    CREATE INDEX IF NOT EXISTS idx_capabilities_visibility ON capabilities(visibility);

    CREATE TABLE IF NOT EXISTS capability_logs (
      id            TEXT PRIMARY KEY,
      capabilityId  TEXT NOT NULL,
      callerGhii    TEXT NOT NULL,
      input         TEXT NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL,
      durationMs    INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      timestamp     TEXT NOT NULL,
      FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_capability_logs_cap ON capability_logs(capabilityId, timestamp);
    CREATE INDEX IF NOT EXISTS idx_capability_logs_status ON capability_logs(capabilityId, status);

    CREATE TABLE IF NOT EXISTS capability_vouches (
      capabilityId  TEXT NOT NULL,
      userGhii      TEXT NOT NULL,
      comment       TEXT,
      createdAt     TEXT NOT NULL,
      PRIMARY KEY (capabilityId, userGhii),
      FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
    );

    -- ── Stats Persistence ──
    CREATE TABLE IF NOT EXISTS stats_counters (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stats_daily_history (
      date  TEXT NOT NULL,
      key   TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, key)
    );

    -- ── Agent Tasks ──
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id              TEXT PRIMARY KEY,
      agentGaii       TEXT NOT NULL,
      ownerGaii       TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      scope           TEXT NOT NULL DEFAULT '[]',
      rules           TEXT NOT NULL DEFAULT '[]',
      verification    TEXT NOT NULL DEFAULT '{}',
      resources       TEXT,
      todos           TEXT NOT NULL DEFAULT '[]',
      status          TEXT NOT NULL DEFAULT 'draft',
      parentTaskId    TEXT,
      workTrackingCode TEXT,
      telemetry       TEXT,
      lastEventAt     TEXT,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL,
      completedAt     TEXT,
      deliverableKey  TEXT,
      rating          TEXT,
      triage          TEXT,
      automation      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agentGaii, status);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_owner ON agent_tasks(ownerGaii);

    -- Agent Task Events
    CREATE TABLE IF NOT EXISTS agent_task_events (
      id          TEXT PRIMARY KEY,
      taskId      TEXT NOT NULL,
      type        TEXT NOT NULL,
      message     TEXT NOT NULL,
      details     TEXT,
      timestamp   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON agent_task_events(taskId, timestamp);

    -- ── Agent Directives ──
    CREATE TABLE IF NOT EXISTS agent_directives (
      agentGaii     TEXT PRIMARY KEY,
      purpose       TEXT NOT NULL DEFAULT '',
      rules         TEXT NOT NULL DEFAULT '[]',
      memoryAreas   TEXT NOT NULL DEFAULT '[]',
      resources     TEXT NOT NULL DEFAULT '[]',
      budgetLimits  TEXT,
      updatedAt     TEXT NOT NULL
    );

    -- Owner Agent Defaults
    CREATE TABLE IF NOT EXISTS owner_agent_defaults (
      ownerGaii           TEXT PRIMARY KEY,
      rules               TEXT NOT NULL DEFAULT '[]',
      defaultTokenBudget  INTEGER,
      defaultMemoryAreas  TEXT NOT NULL DEFAULT '[]',
      updatedAt           TEXT NOT NULL
    );

    -- ── Sharing Groups ──
    CREATE TABLE IF NOT EXISTS sharing_groups (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      description        TEXT,
      ownerGaii          TEXT NOT NULL,
      members            TEXT NOT NULL DEFAULT '[]',
      defaultPermissions TEXT NOT NULL DEFAULT '{"read":true,"write":false}',
      createdAt          TEXT NOT NULL,
      updatedAt          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sharing_groups_owner ON sharing_groups(ownerGaii);

    -- ── Agent Activity (Phase 2 prep) ──
    CREATE TABLE IF NOT EXISTS agent_activity (
      agentGaii TEXT NOT NULL,
      date      TEXT NOT NULL,
      hour      INTEGER NOT NULL,
      metric    TEXT NOT NULL,
      value     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agentGaii, date, hour, metric)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_activity_gaii ON agent_activity(agentGaii, date);

    -- ── Agent Messages (Phase 3) ──
    CREATE TABLE IF NOT EXISTS agent_messages (
      id            TEXT PRIMARY KEY,
      agentGaii     TEXT NOT NULL,
      threadId      TEXT NOT NULL,
      direction     TEXT NOT NULL,
      senderGaii    TEXT NOT NULL,
      content       TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      linkedTaskId  TEXT,
      metadata      TEXT,
      createdAt     TEXT NOT NULL,
      processedAt   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agentGaii, threadId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_pending ON agent_messages(agentGaii, status);

    -- ── Direct Messages (human↔human GHII messaging + federation) ──
    CREATE TABLE IF NOT EXISTS direct_messages (
      id             TEXT NOT NULL,
      ownerGhii      TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      senderGhii     TEXT NOT NULL,
      recipientGhii  TEXT NOT NULL,
      body           TEXT NOT NULL DEFAULT '',
      attachments    TEXT,
      status         TEXT NOT NULL DEFAULT 'queued',
      direction      TEXT NOT NULL,
      replyToId      TEXT,
      origin         TEXT NOT NULL DEFAULT 'local',
      originNodeId   TEXT NOT NULL,
      error          TEXT,
      createdAt      TEXT NOT NULL,
      deliveredAt    TEXT,
      readAt         TEXT,
      PRIMARY KEY (id, ownerGhii)
    );
    CREATE INDEX IF NOT EXISTS idx_direct_messages_inbox ON direct_messages(ownerGhii, direction, createdAt);
    CREATE INDEX IF NOT EXISTS idx_direct_messages_convo ON direct_messages(ownerGhii, conversationId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_direct_messages_status ON direct_messages(status, origin);

    -- ── Contact consent (first-contact gate for direct messages) ──
    CREATE TABLE IF NOT EXISTS contact_consents (
      ownerGhii      TEXT NOT NULL,
      contactId      TEXT NOT NULL,
      state          TEXT NOT NULL DEFAULT 'pending',
      firstMessageId TEXT,
      createdAt      TEXT NOT NULL,
      updatedAt      TEXT NOT NULL,
      PRIMARY KEY (ownerGhii, contactId)
    );
    CREATE INDEX IF NOT EXISTS idx_contact_consents_state ON contact_consents(ownerGhii, state);

    -- ── Direct-message delivery telemetry (operator dashboard; no content/identities) ──
    CREATE TABLE IF NOT EXISTS message_delivery_log (
      id           TEXT PRIMARY KEY,
      messageId    TEXT NOT NULL,
      origin       TEXT NOT NULL,
      targetNodeId TEXT NOT NULL,
      status       TEXT NOT NULL,
      httpStatus   INTEGER,
      errorMessage TEXT,
      latencyMs    INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_delivery_created ON message_delivery_log(createdAt);
    CREATE INDEX IF NOT EXISTS idx_message_delivery_status ON message_delivery_log(status);

    -- ── Telemetry Events (Phase A push layer) ──
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id TEXT PRIMARY KEY,
      agentGaii TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      sessionId TEXT,
      taskId TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_agent_created ON telemetry_events(agentGaii, createdAt);

    -- ── Webhook Delivery Log (Phase A push layer) ──
    CREATE TABLE IF NOT EXISTS webhook_delivery_log (
      id TEXT PRIMARY KEY,
      agentGaii TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      httpStatus INTEGER,
      errorMessage TEXT,
      attemptCount INTEGER NOT NULL DEFAULT 1,
      latencyMs INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_log_agent ON webhook_delivery_log(agentGaii, createdAt);

    -- ── Agent Onboarding (Phase B Hello Integration) ──
    CREATE TABLE IF NOT EXISTS agent_onboarding (
      agentGaii TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      readinessScore INTEGER,
      readinessLevel TEXT,
      detectedPlatform TEXT,
      installedRuntime TEXT,
      onboardingBaseline INTEGER,
      operationalHealth REAL,
      healthComponents TEXT,
      healthRecalculatedAt TEXT,
      readinessOverride TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_onboarding_status ON agent_onboarding(status);

  `);

  // ── Schema migrations for existing databases ──
  // ALTER TABLE ADD COLUMN is idempotent-safe: if the column exists, it throws
  // "duplicate column name" which we catch and ignore.
  const safeAddColumn = (table: string, column: string, type: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* column already exists */ }
  };

  // Owner session refresh tokens — add columns to existing sessions tables, then
  // index the lookup columns (must run AFTER the ALTERs so the columns exist).
  // See docs/plans/2026-06-03-owner-session-refresh-tokens-plan.md
  safeAddColumn('sessions', 'refreshTokenHash', 'TEXT');
  safeAddColumn('sessions', 'prevTokenHash', 'TEXT');
  safeAddColumn('sessions', 'prevValidUntil', 'TEXT');
  safeAddColumn('sessions', 'lastUsedAt', 'TEXT');
  safeAddColumn('sessions', 'idleExpiresAt', 'TEXT');
  safeAddColumn('sessions', 'absoluteExpiresAt', 'TEXT');
  safeAddColumn('sessions', 'deviceLabel', 'TEXT');
  safeAddColumn('sessions', 'userAgent', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_refreshTokenHash ON sessions(refreshTokenHash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_prevTokenHash ON sessions(prevTokenHash)');

  // Phase 2 CORS — GHII-level allowed origins
  safeAddColumn('ghiis', 'allowedOrigins', 'TEXT');

  // Phase 3 CORS — Agent-level allowed origins
  safeAddColumn('agents', 'allowedOrigins', 'TEXT');

  // Phase 4 CORS — Memory-level allowed origins
  safeAddColumn('memory', 'allowedOrigins', 'TEXT');

  // MCP session tracking — agent and OAuth client binding
  safeAddColumn('chat_instances', 'agentGaii', 'TEXT');
  safeAddColumn('chat_instances', 'mcpClientId', 'TEXT');

  // Single-balance migration — per-agent daily spend limit
  safeAddColumn('agents', 'dailySpendLimit', 'REAL DEFAULT NULL');

  // Task deliverable memory key — link a completed task to its output entry
  safeAddColumn('agent_tasks', 'deliverableKey', 'TEXT');
  // Quality tab — per-context task rating (JSON: AgentTaskRating)
  safeAddColumn('agent_tasks', 'rating', 'TEXT');
  // Tasks-tab triage bucket: 'kept' | 'archived' | NULL (default/auto)
  safeAddColumn('agent_tasks', 'triage', 'TEXT');
  // Ecosystem-app automation provenance/routing (B5/B6): JSON
  // { recipeId, app, organism?, email?, requireApproval? } | NULL
  safeAddColumn('agent_tasks', 'automation', 'TEXT');

  // Package instance status rename: 'active' -> 'installed'
  db.exec("UPDATE package_instances SET status = 'installed' WHERE status = 'active'");

  // Federation Mesh Phase 1 — peer policy fields
  safeAddColumn('federation_peers', 'shareCatalogue', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'replicateMemory', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'allowRouting', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'peerMode', "TEXT NOT NULL DEFAULT 'federation'");

  // Federation Mesh Phase 1 — per-record federation opt-in
  safeAddColumn('actions', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('boards', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('storage_files', 'federate', 'INTEGER NOT NULL DEFAULT 0');

  // Security audit — per-account password brute-force protection
  safeAddColumn('ghiis', 'passwordFailedAttempts', 'INTEGER DEFAULT 0');
  safeAddColumn('ghiis', 'passwordLockedUntil', 'TEXT');

  // Security audit — per-peer federation auth policy
  safeAddColumn('federation_peers', 'allowFederatedAuth', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('federation_peers', 'federationAuthScopes', "TEXT NOT NULL DEFAULT ''");

  // Agent Dashboard Phase 1 — sharing group references + agent capabilities/activity
  safeAddColumn('memory', 'groupId', 'TEXT');
  safeAddColumn('storage_files', 'groupId', 'TEXT');
  safeAddColumn('agents', 'technicalCapabilities', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'domainCapabilities', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'activityStats', "TEXT DEFAULT '{}'");
  safeAddColumn('agents', 'modulesLoaded', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'agentLimitations', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'languages', "TEXT DEFAULT '[]'");
  safeAddColumn('extensions', 'createdByAgent', 'TEXT');

  // Governance Phase C — budget limits on agent directives
  safeAddColumn('agent_directives', 'budgetLimits', 'TEXT');

  // Agent Scheduler — recurring schedules (ai/agent_task kinds), owner scoping,
  // budget constraints, timezone. All additive/nullable; existing core/extension
  // rows read back unchanged.
  safeAddColumn('scheduled_jobs', 'ownerScope', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentGaii', 'TEXT');
  safeAddColumn('scheduled_jobs', 'createdByAgent', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('scheduled_jobs', 'displayName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'description', 'TEXT');
  safeAddColumn('scheduled_jobs', 'purpose', 'TEXT');
  safeAddColumn('scheduled_jobs', 'timezone', 'TEXT');
  safeAddColumn('scheduled_jobs', 'constraints', 'TEXT');
  safeAddColumn('scheduled_jobs', 'runCount', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('execution_log', 'taskId', 'TEXT');
  safeAddColumn('agents', 'scheduleConstraintDefaults', 'TEXT');

  // Push Layer Phase A — webhook delivery fields
  safeAddColumn('agents', 'webhookUrl', 'TEXT');
  safeAddColumn('agents', 'webhookSecret', 'TEXT');
  safeAddColumn('agents', 'webhookEnabled', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'webhookLastSuccess', 'TEXT');
  safeAddColumn('agents', 'webhookLastFailure', 'TEXT');
  safeAddColumn('agents', 'webhookFailCount', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'platform', 'TEXT');
  safeAddColumn('agents', 'platformVersion', 'TEXT');
  safeAddColumn('agents', 'platformDetectedBy', 'TEXT');
  safeAddColumn('agents', 'tags', 'TEXT');

  // Agent operational mode (autonomous | interactive | task-runner | coordinator | workstation)
  // Default 'interactive' = backward-compatible: all existing agents went through
  // the full 13-step Hello Integration which matches interactive semantics.
  safeAddColumn('agents', 'mode', "TEXT DEFAULT 'interactive'");

  // Max concurrent tasks the agent's runner may process. Default 1 = serial
  // (backward-compatible). >1 requires a concurrency-capable engine (read by the
  // runner; not enforced server-side).
  safeAddColumn('agents', 'maxConcurrentTasks', 'INTEGER NOT NULL DEFAULT 1');

  // device_auth.mode -- mode the CLI passed to /v1/agents/device-authorize.
  // verify-route reads this when the owner approves, and propagates it to
  // storage.createAgent so the new agent ends up with the right server-side
  // mode. Without this column the mode silently dropped, the agent was always
  // created as 'interactive', and Hello Integration ran the full 13 steps even
  // when the operator clearly asked for task-runner.
  safeAddColumn('device_auth', 'mode', "TEXT DEFAULT 'interactive'");

  // Ecosystem-app automation — persist the app's declared capabilities + automation
  // hints (JSON) so an owner can schedule an `eco-capability` job that names a real
  // capability. Additive/nullable; existing eco rows read back unchanged.
  safeAddColumn('eco_auth', 'capabilities', 'TEXT');
  safeAddColumn('eco_auth', 'automation', 'TEXT');
  safeAddColumn('ecosystem_apps', 'capabilities', 'TEXT');
  safeAddColumn('ecosystem_apps', 'automation', 'TEXT');

  // Ecosystem-app SETUP guide — the app's OWN bilingual Markdown setup guide ({ fi, en }), stored as
  // a JSON column and rendered to the owner in the app card. Additive/nullable; old eco rows have
  // none and the portal shows a graceful "re-connect to load one" fallback.
  safeAddColumn('eco_auth', 'setup', 'TEXT');
  safeAddColumn('ecosystem_apps', 'setup', 'TEXT');
}
