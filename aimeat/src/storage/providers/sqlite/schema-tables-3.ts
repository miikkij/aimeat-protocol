/**
 * @file sqlite/schema-tables-3.ts
 * @description SQLite CREATE TABLE/INDEX DDL — part 3 of 3 (OAuth … agent onboarding). Extracted from sqlite/schema.ts
 *   to satisfy max-file-lines. Idempotent (IF NOT EXISTS); applied in numeric order so
 *   the on-disk DDL order is byte-for-byte unchanged from the original single exec block.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from sqlite/schema.ts (max-file-lines)
 */
import type Database from 'better-sqlite3';

export function applySchemaTables3(db: Database.Database): void {
  db.exec(`
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

    -- Operator storage-growth telemetry: one row per hourly snapshot; counts = { table: rowCount } JSON.
    CREATE TABLE IF NOT EXISTS storage_stats_snapshots (
      id         TEXT PRIMARY KEY,
      capturedAt TEXT NOT NULL,
      counts     TEXT NOT NULL,
      totalRows  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_storage_stats_capturedAt ON storage_stats_snapshots(capturedAt);

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
      dedupeKey       TEXT,
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
      subject        TEXT,
      senderGhii     TEXT NOT NULL,
      recipientGhii  TEXT NOT NULL,
      body           TEXT NOT NULL DEFAULT '',
      attachments    TEXT,
      interactive    TEXT,
      broadcastId    TEXT,
      respondable    INTEGER,
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

    -- ── Contact consent (first-contact gate for direct messages + the owner's address book) ──
    CREATE TABLE IF NOT EXISTS contact_consents (
      ownerGhii      TEXT NOT NULL,
      contactId      TEXT NOT NULL,
      state          TEXT NOT NULL DEFAULT 'pending',
      origin         TEXT NOT NULL DEFAULT 'message',
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

    -- ── Agent LLM Usage Ledger (LEDGER / TARGET-016) ──
    -- Append-only per-call events = source of truth (billing audit, TARGET-019).
    -- costUsd/priceRef are nullable: a missing price stays null (never coerced to 0).
    -- Context cols (organism/workspace/capability) ship in the schema from v1 but are
    -- filled only once TARGET-018 wires context through the run — no later migration.
    CREATE TABLE IF NOT EXISTS agent_usage_event (
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
      provenanceId     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_event_owner ON agent_usage_event(ownerGhii, ts);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_event_agent ON agent_usage_event(agentGaii, ts);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_event_run ON agent_usage_event(runId);

    -- Daily rollup, upsert-incremented. Context dims default to '' (not NULL) so the
    -- composite PK stays NULL-free for ON CONFLICT upsert. UI reads this, not raw events.
    CREATE TABLE IF NOT EXISTS agent_usage_daily (
      date             TEXT NOT NULL,
      agentGaii        TEXT NOT NULL,
      ownerGhii        TEXT NOT NULL,
      apiKeyScope      TEXT NOT NULL DEFAULT 'own',
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      organismId       TEXT NOT NULL DEFAULT '',
      workspaceId      TEXT NOT NULL DEFAULT '',
      promptTokens     INTEGER NOT NULL DEFAULT 0,
      completionTokens INTEGER NOT NULL DEFAULT 0,
      costUsd          REAL NOT NULL DEFAULT 0,
      calls            INTEGER NOT NULL DEFAULT 0,
      unpricedCalls    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, agentGaii, ownerGhii, apiKeyScope, model, provider, organismId, workspaceId)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_owner ON agent_usage_daily(ownerGhii, date);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_daily_org ON agent_usage_daily(organismId, date);

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

    -- ── AI Provenance records (TARGET-058, EU AI Act Art. 50) ──
    -- APPEND-ONLY: a record is an attributable statement about a specific set of bytes. Correcting
    -- one means minting a new record about the new bytes, never editing the old statement — so
    -- there is no UPDATE path anywhere in the repository.
    -- The record column holds the canonical aimeat.provenance/v1 document as JSON and is the single
    -- source of truth; the columns beside it are AIMEAT's authorization + lookup metadata, not spec.
    -- contentHash is NOT unique: the same bytes can honestly be generated twice, and the second
    -- statement does not invalidate the first.
    CREATE TABLE IF NOT EXISTS ai_provenance (
      id          TEXT PRIMARY KEY,
      ownerGhii   TEXT NOT NULL,
      principal   TEXT NOT NULL,
      contentHash TEXT,
      visibility  TEXT NOT NULL DEFAULT 'private',
      generatedAt TEXT NOT NULL,
      createdAt   TEXT NOT NULL,
      record      TEXT NOT NULL
    );
    -- The detection lookup ("did this node produce these exact bytes?") is hash-keyed and public,
    -- so it is the one query that must stay index-backed under anonymous traffic.
    CREATE INDEX IF NOT EXISTS idx_ai_provenance_hash ON ai_provenance(contentHash);
    CREATE INDEX IF NOT EXISTS idx_ai_provenance_owner ON ai_provenance(ownerGhii, generatedAt);

  `);
}
