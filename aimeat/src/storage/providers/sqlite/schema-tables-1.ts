/**
 * @file sqlite/schema-tables-1.ts
 * @description SQLite CREATE TABLE/INDEX DDL — part 1 of 3 (owners … site_changelog). Extracted from sqlite/schema.ts
 *   to satisfy max-file-lines. Idempotent (IF NOT EXISTS); applied in numeric order so
 *   the on-disk DDL order is byte-for-byte unchanged from the original single exec block.
 * @version-history
 *   v1.4.0 — 2026-08-13 — agents.registeredBy (migration 0035).
 *   v1.3.0 — 2026-08-13 — agents.consoleUrl (see migration 0034 for why). schema.ts adds it to an
 *     existing database; this is the fresh-install shape.
 *   v1.2.0 — 2026-08-11 — Drop the feedback table. The Node Feedback Channel is gone; its job is
 *     done by support@operators, an ordinary group conversation the operators answer in Messages.
 *   v1.2.0 — 2026-08-11 — push_subscriptions is keyed on (ownerName, endpoint): one row per device
 *     instead of one per person (audit H-8). Mirrors Postgres migration 0032.
 *   v1.1.0 — 2026-07-16 — Add feedback table (Node Feedback Channel).
 *   v1.0.0 — 2026-07-13 — Extracted from sqlite/schema.ts (max-file-lines)
 */
import type Database from 'better-sqlite3';

export function applySchemaTables1(db: Database.Database): void {
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
      model              TEXT,
      modelDetectedBy    TEXT,
      tags               TEXT,
      consoleUrl         TEXT,
      registeredBy       TEXT
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
      trackable      INTEGER NOT NULL DEFAULT 0,
      archived       INTEGER NOT NULL DEFAULT 0,
      archivedAt     TEXT,
      archivedBy     TEXT,
      archivedRoot   TEXT,
      -- ATTACHED AI provenance (TARGET-058): the ai_provenance row describing how this value was
      -- produced. NULL = unstated, which is not the same as "a human wrote it".
      aiProvenanceId TEXT,
      PRIMARY KEY (ownerGaii, key)
    );

    -- ── Memory version history ──
    -- When a TRACKABLE memory key is overwritten, the PREVIOUS value is appended here before the
    -- update so memory keeps only the latest version (stays light) while the full history lives in a
    -- separate table queried only when needed (e.g. the organism structure timeline). Append-only.
    CREATE TABLE IF NOT EXISTS memory_history (
      ownerGaii    TEXT NOT NULL,
      key          TEXT NOT NULL,
      version      INTEGER NOT NULL,
      value        TEXT,
      actor        TEXT,
      event        TEXT,
      recordedAt   TEXT NOT NULL,
      PRIMARY KEY (ownerGaii, key, version)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_history_key ON memory_history (ownerGaii, key, version DESC);

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
      initiatorGaii    TEXT,
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
      googleSub                  TEXT,
      externalIdentities         TEXT,
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
      memberVisibility TEXT,
      moderationConfig TEXT NOT NULL DEFAULT '{}',
      memoryNamespace  TEXT NOT NULL,
      semantic         TEXT,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      archived         INTEGER NOT NULL DEFAULT 0,
      archivedAt       TEXT,
      archivedBy       TEXT
    );

    -- ── Organism Memberships ──
    CREATE TABLE IF NOT EXISTS organism_memberships (
      id             TEXT PRIMARY KEY,
      organismId     TEXT NOT NULL,
      ghii           TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'member',
      status         TEXT NOT NULL DEFAULT 'active',
      joinedAt       TEXT NOT NULL,
      invitedBy      TEXT,
      invitedWorkspaces TEXT
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
    -- One row per DEVICE: the key is (ownerName, endpoint), so the owner's phone and laptop both
    -- receive, and a caller cannot take over the notification stream by subscribing (audit H-8).
    -- A database created before 2026-08-11 has ownerName alone as the key and is rebuilt in
    -- schema.ts; mirrors Postgres migration 0032.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      ownerName      TEXT NOT NULL,
      endpoint       TEXT NOT NULL,
      keys           TEXT NOT NULL DEFAULT '{}',
      createdAt      TEXT NOT NULL,
      lastUsedAt     TEXT NOT NULL,
      PRIMARY KEY (ownerName, endpoint)
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
      -- TARGET-057: flow-specific JSON the callback needs and the URL must not carry (provider,
      -- instance, mode). In the redirect URL instead, whoever calls the callback would get to
      -- choose which provider their code is redeemed against.
      payload        TEXT,
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
  `);
}
