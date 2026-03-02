import express from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from './config.js';
import { InMemoryStorage } from './storage/memory.js';
import { generateKeyPair } from './auth/keypair.js';
import { initNodeKeys } from './auth/jwt.js';
import { optionalAuth, enableAnonymousAuth } from './auth/middleware.js';
import { logger } from './utils/logger.js';

// Routes
import { bootstrapRouter } from './routes/bootstrap.js';
import { wellknownRouter } from './routes/wellknown.js';
import { authRouter } from './routes/auth.js';
import { ownersRouter } from './routes/owners.js';
import { agentsRouter } from './routes/agents.js';
import { schemaRouter } from './routes/schemas.js';
import { consentRouter } from './routes/consent.js';
import { memoryRouter } from './routes/memory.js';
import { actionsRouter } from './routes/actions.js';
import { catalogueRouter } from './routes/catalogue.js';
import { workRouter } from './routes/work.js';
import { walletRouter } from './routes/wallet.js';
import { boardsRouter } from './routes/boards.js';
import { promptsRouter } from './routes/prompts.js';
import { adminRouter } from './routes/admin.js';
import { federationRouter } from './routes/federation.js';
import { specRouter } from './routes/spec.js';
import { disputesRouter } from './routes/disputes.js';
import { microMemoryRouter } from './routes/micro-memory.js';
import { storageFilesRouter } from './routes/storage-files.js';
import { validateRouter } from './routes/validate.js';
import { mcpRouter } from './routes/mcp.js';
import { portalRouter } from './routes/portal.js';
import { humanPortalRouter } from './routes/portal-human.js';
import { profileRouter } from './routes/profile.js';
import { csmRouter } from './routes/csm.js';
import { ghiiRouter } from './routes/ghii.js';
import { totpRouter } from './routes/totp.js';
import { libsRouter } from './routes/libs.js';
import { appsRouter } from './routes/apps.js';
import { aimeatOsRouter } from './routes/aimeat-os.js';
import { guidesRouter } from './routes/guides.js';
import { flagsRouter } from './routes/flags.js';
import { appealsRouter } from './routes/appeals.js';
import { matchesRouter } from './routes/matches.js';
import { organismsRouter } from './routes/organisms.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { portalMarketplaceRouter } from './routes/portal-marketplace.js';
import { personalRouter } from './routes/personal.js';
import { pushRouter } from './routes/push.js';
import { createPushService } from './services/push.js';
import { verificationRouter } from './routes/verification.js';
import { createEudiwService } from './services/eudiw.js';
import { createVcIssuerService } from './services/vc-issuer.js';
import { createMyDataReceiptService } from './services/mydata-receipt.js';
import { rateLimit } from './middleware/rate-limit.js';
import { idempotency } from './middleware/idempotency.js';
import { cookieConsentMiddleware } from './middleware/cookie-consent.js';
import type { Storage, MaintenanceState } from './storage/interface.js';
import { startHeartbeatJob } from './services/federation.js';
import type { PeerInfo } from './services/federation.js';
import { TunnelManager } from './services/personal-tunnel.js';
import { startConsentExpiryJob } from './services/consent.js';
import { seedProfileSchemas } from './services/profile-schemas.js';
import { createEmailService } from './services/email.js';
import { DirectoryService } from './services/directory.js';
import { portalHobbiesRouter } from './routes/portal-hobbies.js';
import { startMatchNotificationJob } from './services/match-notification.js';
import { createMatchingEngine, startMatchingScheduler } from './services/matching.js';

export interface ServerResult {
  app: express.Express;
  tunnelManager: TunnelManager | null;
  storage: Storage;
}

export async function createServer(config: AimeatConfig): Promise<ServerResult> {
  const app = express();

  // Global middleware
  app.use(express.json({ limit: '15mb' }));
  app.use(express.text({ limit: '1mb', type: ['text/yaml', 'application/x-yaml'] }));

  // Serve static assets (platform icons, etc.)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const publicDir = join(__dirname, '..', 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { maxAge: '7d' }));
  }

  // PWA static files (manifest.json, sw.js, offline.html, icons)
  const pwaStaticDir = join(__dirname, '..', 'src', 'static');
  if (existsSync(pwaStaticDir)) {
    app.use(express.static(pwaStaticDir, { maxAge: '1d' }));
  }

  // Cookie consent banner injection (opt-in for service builders)
  app.use(cookieConsentMiddleware(config));

  // CORS for Tier 0 endpoints
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Rate limiting — global (with role multipliers)
  // optionalAuth() must run first so req.auth is available for per-identity rate limiting
  app.use(optionalAuth());
  app.use(rateLimit(config.rateLimits.global, config.rateLimits.roleMultipliers));

  // Per-tier rate limits
  app.use('/v1/auth', rateLimit(config.rateLimits.auth, config.rateLimits.roleMultipliers));
  app.use('/v1/work', rateLimit(config.rateLimits.work, config.rateLimits.roleMultipliers));
  app.use('/v1/memory', rateLimit(config.rateLimits.memory, config.rateLimits.roleMultipliers));
  app.use('/v1/boards', rateLimit(config.rateLimits.boards, config.rateLimits.roleMultipliers));

  // Idempotency-Key support for POST/PUT
  app.use(idempotency());

  // Storage — select based on config
  let storage: Storage;
  if (config.dbUrl) {
    const { MongoStorage } = await import('./storage/mongodb.js');
    const mongo = new MongoStorage(config.dbUrl);
    await mongo.ready;
    storage = mongo;
    logger.info('Using MongoDB storage', { url: config.dbUrl.replace(/\/\/.*@/, '//<credentials>@') });
  } else {
    storage = new InMemoryStorage();
    logger.info('Using in-memory storage (data will not persist across restarts)');
  }

  // Maintenance mode cache — loaded once from storage, updated on toggle
  let maintenanceCache: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };
  try {
    maintenanceCache = await storage.getMaintenanceMode();
  } catch { /* default to disabled */ }

  // Initialize node keys asynchronously
  initializeNode(config, storage);

  // Anonymous mode: auto-create anonymous owner + agent if not already present
  if (config.anonymousMode) {
    await setupAnonymousIdentity(config, storage);
  }

  // Start daily allowance background job
  startDailyAllowanceJob(config, storage);

  // Start work timeout expiry job
  startWorkTimeoutJob(config, storage);

  // Start memory TTL cleanup job (every 5m)
  startMemoryTtlCleanupJob(storage);

  // Start board post TTL cleanup job (every 10m)
  startBoardPostTtlCleanupJob(storage);

  // Start dispute auto-escalation job
  startDisputeTimeoutJob(config, storage);

  // Start consent expiry background job (every 10m) — Phase 0.3
  if (config.consentEnabled) {
    startConsentExpiryJob(storage);
    logger.info('Consent expiry job scheduled (every 10m)');
  }

  // Seed standardized profile schemas — Phase 0.4
  seedProfileSchemas(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Seeded ${count} profile schemas`); })
    .catch(err => logger.error('Failed to seed profile schemas', { error: err }));

  // Directory service — Phase 1.4 (indexes GHII profiles for local + thematic search)
  const directoryService = new DirectoryService(config, storage);
  directoryService.rebuildIndex()
    .then(() => logger.info('Directory index built'))
    .catch(err => logger.error('Failed to build directory index', { error: String(err) }));

  // Federation peer registry (shared between routes and heartbeat)
  const peers = new Map<string, PeerInfo>();

  // Start federation heartbeat job (pings peers every 5 minutes)
  startHeartbeatJob(config, peers);

  // Personal Node tunnel manager (operator-side)
  let tunnelManager: TunnelManager | null = null;
  if (config.personalNodesEnabled && config.nodeType === 'full') {
    tunnelManager = new TunnelManager(config, storage);
    tunnelManager.startHeartbeatMonitor();
    logger.info('Personal node support enabled', { maxSlots: config.personalNodeMaxSlots });

    // Start mailbox cleanup job (every 10m)
    startMailboxCleanupJob(storage);
  }

  // ── Maintenance mode guard ──
  // Returns 503 for non-essential paths when maintenance is enabled.
  // Operators always pass. Essential paths (health, admin, spec, well-known) always pass.
  app.use((req, res, next) => {
    if (!maintenanceCache.enabled) { next(); return; }

    // Operators always bypass
    if (req.auth?.roles?.includes('operator')) { next(); return; }

    // Essential paths always bypass
    const p = req.path;
    if (
      p === '/' ||
      p === '/v1/health' ||
      p.startsWith('/v1/admin') ||
      p.startsWith('/v1/spec') ||
      p.startsWith('/.well-known') ||
      p.startsWith('/v1/federation/peer/introduce') ||
      p.startsWith('/v1/federation/directory') ||
      p.startsWith('/favicon') ||
      req.method === 'OPTIONS'
    ) { next(); return; }

    const msg = maintenanceCache.message || 'This node is temporarily offline for maintenance.';

    // Serve HTML for browsers, JSON for API clients
    if (req.accepts(['html', 'json']) === 'html') {
      res.status(503).type('text/html').send(maintenancePageHtml(config.nodeId, msg));
      return;
    }

    res.status(503).json({
      ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: { code: 'MAINTENANCE_MODE', message: msg },
    });
  });

  // ── Node-type guards ──
  // Relay nodes: stateless routers — no agent hosting, memory, work, boards
  const rejectForRelay: express.RequestHandler = (_req, res, next) => {
    if (config.nodeType === 'relay') {
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'NODE_TYPE_UNSUPPORTED', message: 'Relay nodes do not host agents or data. Use a Full node.' },
      });
      return;
    }
    next();
  };

  // Mirror nodes: read-only replicas — block all write operations
  const mirrorReadOnly: express.RequestHandler = (req, res, next) => {
    if (config.nodeType === 'mirror' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // Allow federation replication inbound (mirror receives data from peers)
      if (req.path.startsWith('/v1/federation/replicate') || req.path.startsWith('/v1/federation/catalogue-sync')) {
        next();
        return;
      }
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'MIRROR_READ_ONLY', message: 'Mirror nodes are read-only. Direct writes to a Full node.' },
      });
      return;
    }
    next();
  };

  // Mount routes
  app.use(bootstrapRouter(config));
  app.use(wellknownRouter(config, storage));

  // IndexNow key verification file (serves /{key}.txt for Bing/Yandex)
  if (config.indexNowKey) {
    app.get(`/${config.indexNowKey}.txt`, (_req, res) => {
      res.type('text/plain').send(config.indexNowKey);
    });
  }

  app.use(authRouter(config, storage));

  // Relay nodes skip agent-hosting routes entirely
  app.use('/v1/owners', rejectForRelay);
  app.use('/v1/agents', rejectForRelay);
  app.use('/v1/memory', rejectForRelay);
  app.use('/v1/work', rejectForRelay);
  app.use('/v1/wallet', rejectForRelay);
  app.use('/v1/boards', rejectForRelay);
  app.use('/v1/disputes', rejectForRelay);
  app.use('/v1/micro-memory', rejectForRelay);
  app.use('/v1/storage', rejectForRelay);

  // Mirror nodes block writes (except federation replication)
  app.use(mirrorReadOnly);

  app.use(ownersRouter(config, storage));
  app.use(agentsRouter(config, storage));
  app.use(consentRouter(config, storage));  // Phase 0.3
  app.use(schemaRouter(config, storage));  // MUST be before memoryRouter (Phase 0.1)
  app.use(memoryRouter(config, storage));
  app.use(csmRouter(config, storage));       // Phase 0.2 — CSM management
  app.use(actionsRouter(config, storage));
  app.use(catalogueRouter(config, storage, directoryService));
  app.use(workRouter(config, storage, peers));
  app.use(walletRouter(config, storage));

  // Extended features guard — returns 503 when extended features are disabled
  const requireExtended: express.RequestHandler = (_req, res, next) => {
    if (!config.extendedFeaturesEnabled) {
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'FEATURE_DISABLED', message: 'Extended features are disabled on this node' },
      });
      return;
    }
    next();
  };

  app.use('/v1/boards', requireExtended);
  app.use('/v1/federation', (req, res, next) => {
    // Allow unauthenticated introduce endpoints (federation join flow)
    if (req.path.startsWith('/peer/introduce')) return next();
    // Allow public directory and heartbeat/ping
    if (req.path === '/directory' || req.path === '/ping' || req.path === '/heartbeat') return next();
    return requireExtended(req, res, next);
  });
  app.use('/v1/storage', requireExtended);
  app.use('/v1/validate', requireExtended);

  app.use(boardsRouter(config, storage));
  app.use(promptsRouter(config, storage));
  app.use(adminRouter(config, storage, {
    get: () => maintenanceCache,
    set: (state: MaintenanceState) => { maintenanceCache = state; },
  }));
  app.use(federationRouter(config, storage, peers));
  app.use(disputesRouter(config, storage));
  app.use(flagsRouter(config, storage));
  app.use(appealsRouter(config, storage));
  app.use(matchesRouter(config, storage));
  app.use(organismsRouter(config, storage));
  app.use(marketplaceRouter(config, storage));
  app.use(microMemoryRouter(config, storage));
  app.use(storageFilesRouter(config, storage));
  app.use(validateRouter(config));
  app.use(mcpRouter(config, storage));
  app.use(portalRouter(config, storage));
  app.use(humanPortalRouter(config, storage));
  app.use(portalHobbiesRouter(config, storage, directoryService));
  app.use(portalMarketplaceRouter(config, storage));
  app.use(profileRouter(config, storage));
  // Phase 1.1 — Email service for verification and magic links
  const emailService = createEmailService(config);

  // Push notification service — Phase 3.1
  const pushService = createPushService(config, storage);
  app.use(pushRouter(config, storage, pushService));

  // EUDIW / VC / MyData services — Phase 3.3
  const eudiwService = createEudiwService(config, storage);
  const vcIssuerService = createVcIssuerService(config);
  const mydataReceiptService = createMyDataReceiptService(config);
  app.use(verificationRouter(config, storage, eudiwService, vcIssuerService, mydataReceiptService));

  // Match notification job — Phase 1.6
  startMatchNotificationJob(config, storage, emailService, directoryService);

  // AI Matching — Phase 2.1
  const matchingEngine = createMatchingEngine(config, storage, directoryService, emailService);
  startMatchingScheduler(config, matchingEngine);

  app.use(totpRouter(config, storage));   // Phase 0.5 — MUST be before ghiiRouter (TOTP routes use /v1/ghii/totp/*)
  app.use(ghiiRouter(config, storage, emailService));
  app.use(libsRouter(config, storage));
  app.use(appsRouter(config, storage));
  app.use(aimeatOsRouter(config));
  app.use(guidesRouter(config));
  app.use(specRouter());

  // Personal node management routes
  if (config.personalNodesEnabled) {
    app.use(personalRouter(config, storage, tunnelManager));
  }

  // Global error handler
  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    const isPayloadError = err.type === 'entity.too.large' || status === 413;
    if (status >= 500) {
      logger.error('Unhandled error', { error: err.message, stack: err.stack });
    }
    res.status(status).json({
      ok: false,
      protocol: 'aimeat',
      version: 'v1',
      node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: {
        code: isPayloadError ? 'QUOTA_EXCEEDED' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: isPayloadError ? 'Request body too large' : status >= 500 ? 'An unexpected error occurred' : err.message,
      },
      hints: {
        next_actions: [
          { description: 'Try again or check node status', method: 'GET', url: '/' },
        ],
      },
    });
  });

  return { app, tunnelManager, storage };
}

// Daily allowance: credit all agents every 24 hours (or on first activity)
function startDailyAllowanceJob(config: AimeatConfig, storage: Storage): void {
  const creditAllAgents = async () => {
    try {
      const agents = await storage.listAgents();
      for (const agent of agents) {
        if (agent.morselBalance < config.dailyAllowanceCap) {
          const credit = Math.min(config.dailyAllowance, config.dailyAllowanceCap - agent.morselBalance);
          if (credit > 0) {
            await storage.updateAgent(agent.gaii, {
              morselBalance: agent.morselBalance + credit,
            });
          }
        }
      }
      logger.info(`Daily allowance credited to ${agents.length} agents`);
    } catch (err) {
      logger.error('Daily allowance job failed', { error: err });
    }
  };

  // Run daily (every 24 hours)
  setInterval(creditAllAgents, 24 * 3600_000);
  logger.info('Daily allowance job scheduled (every 24h)');
}

// Work timeout: expire work items whose TTL has passed, return escrow
function startWorkTimeoutJob(config: AimeatConfig, storage: Storage): void {
  const expireTimedOutWork = async () => {
    try {
      const allWork = await storage.listAllWork();
      const now = Date.now();
      for (const work of allWork) {
        if (['pending', 'accepted', 'in_progress'].includes(work.status)) {
          if (new Date(work.ttlExpiresAt).getTime() < now) {
            // Return escrow to requester
            const { returnEscrow } = await import('./services/morsel.js');
            await returnEscrow(storage, work);
            await storage.updateWork(work.trackingCode, {
              status: 'expired',
              updatedAt: new Date().toISOString(),
            });

            // Fire callback webhook if provided
            if (work.callbackUrl) {
              const body = JSON.stringify({
                event: 'work.expired',
                tracking_code: work.trackingCode,
                status: 'expired',
                timestamp: new Date().toISOString(),
              });
              fetch(work.callbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(10_000),
              }).catch(() => { /* fire and forget */ });
            }

            logger.info(`Work ${work.trackingCode} expired (TTL exceeded)`);
          }
        }
      }
    } catch (err) {
      logger.error('Work timeout job failed', { error: err });
    }
  };

  // Check every 60 seconds
  setInterval(expireTimedOutWork, 60_000);
  logger.info('Work timeout job scheduled (every 60s)');
}

// Memory TTL cleanup: remove expired memory entries
function startMemoryTtlCleanupJob(storage: Storage): void {
  const cleanup = async () => {
    try {
      const now = Date.now();
      const allAgents = await storage.listAgents();
      for (const agent of allAgents) {
        const memories = await storage.listMemory(agent.gaii);
        for (const mem of memories) {
          if (mem.ttlHours) {
            const expiresAt = new Date(mem.createdAt).getTime() + mem.ttlHours * 3_600_000;
            if (now > expiresAt) {
              await storage.deleteMemory(agent.gaii, mem.key);
            }
          }
        }
      }
    } catch (err) {
      logger.error('Memory TTL cleanup job failed', { error: err });
    }
  };

  setInterval(cleanup, 5 * 60_000); // Every 5 minutes
  logger.info('Memory TTL cleanup job scheduled (every 5m)');
}

// Board post TTL cleanup: remove expired board posts
function startBoardPostTtlCleanupJob(storage: Storage): void {
  const cleanup = async () => {
    try {
      const boards = await storage.listBoards();
      for (const board of boards) {
        // listPosts filters expired posts in-memory and deletes them
        await storage.listPosts(board.id, { limit: 10000 });
      }
    } catch (err) {
      logger.error('Board post TTL cleanup job failed', { error: err });
    }
  };

  setInterval(cleanup, 10 * 60_000); // Every 10 minutes
  logger.info('Board post TTL cleanup job scheduled (every 10m)');
}

// Dispute auto-escalation and timeout (RFC 10.8)
function startDisputeTimeoutJob(config: AimeatConfig, storage: Storage): void {
  const processDisputes = async () => {
    try {
      const now = Date.now();
      const SEVEN_DAYS = 7 * 24 * 3_600_000;
      const THIRTY_DAYS = 30 * 24 * 3_600_000;

      const allWork = await storage.listAllWork();
      for (const work of allWork) {
        if (work.status !== 'disputed' && work.status !== 'contested' && work.status !== 'escalated') continue;

        const dispute = await storage.getDisputeByTrackingCode(work.trackingCode);
        if (!dispute) continue;

        const disputeAge = now - new Date(dispute.createdAt).getTime();

        // Auto-escalate after 7 days if still open/contested
        if ((dispute.status === 'open' || dispute.status === 'contested') && disputeAge > SEVEN_DAYS) {
          await storage.updateDispute(dispute.id, {
            status: 'escalated',
            updatedAt: new Date().toISOString(),
          });

          const log = await storage.getDisputeAuditLog(dispute.id);
          const prevHash = log.length > 0 ? log[log.length - 1].hash : '0';
          const { createHash } = await import('node:crypto');
          const entryData = JSON.stringify({ event: 'auto_escalated', actor: 'system', timestamp: new Date().toISOString() });
          const hash = createHash('sha256').update(prevHash + entryData).digest('hex');

          await storage.addDisputeAuditEntry(dispute.id, {
            sequence: log.length + 1,
            event: 'escalated',
            actor: 'system',
            timestamp: new Date().toISOString(),
            data: { reason: 'Auto-escalated after 7 days without resolution' },
            hash,
            previousHash: prevHash,
          });

          logger.info(`Dispute ${dispute.id} auto-escalated after 7 days`);
        }

        // Auto-resolve (timeout) after 30 days if still escalated
        if (dispute.status === 'escalated' && disputeAge > THIRTY_DAYS) {
          // Return escrow to requester
          const { returnEscrow } = await import('./services/morsel.js');
          await returnEscrow(storage, work);

          await storage.updateDispute(dispute.id, {
            status: 'resolved',
            ruling: {
              ruling: 'timeout',
              distribution: { toRequester: work.cost.total, toProvider: 0, burned: 0 },
              reason: 'Auto-resolved: dispute timed out after 30 days',
            },
            updatedAt: new Date().toISOString(),
          });

          await storage.updateWork(work.trackingCode, {
            status: 'settled',
            updatedAt: new Date().toISOString(),
          });

          const log = await storage.getDisputeAuditLog(dispute.id);
          const prevHash = log.length > 0 ? log[log.length - 1].hash : '0';
          const { createHash } = await import('node:crypto');
          const entryData = JSON.stringify({ event: 'timeout_resolved', actor: 'system', timestamp: new Date().toISOString() });
          const hash = createHash('sha256').update(prevHash + entryData).digest('hex');

          await storage.addDisputeAuditEntry(dispute.id, {
            sequence: log.length + 1,
            event: 'timeout_resolved',
            actor: 'system',
            timestamp: new Date().toISOString(),
            data: { reason: 'Auto-resolved after 30 days without operator ruling' },
            hash,
            previousHash: prevHash,
          });

          logger.info(`Dispute ${dispute.id} auto-resolved (timeout after 30 days)`);
        }
      }
    } catch (err) {
      logger.error('Dispute timeout job failed', { error: err });
    }
  };

  setInterval(processDisputes, 3_600_000); // Every hour
  logger.info('Dispute timeout job scheduled (every 1h)');
}

// Mailbox cleanup: remove expired mailbox items for offline personal nodes
function startMailboxCleanupJob(storage: Storage): void {
  const cleanup = async () => {
    try {
      const removed = await storage.cleanExpiredMailboxItems();
      if (removed > 0) logger.info(`Mailbox cleanup: removed ${removed} expired items`);
    } catch (err) {
      logger.error('Mailbox cleanup job failed', { error: err });
    }
  };

  setInterval(cleanup, 10 * 60_000); // Every 10 minutes
  logger.info('Mailbox cleanup job scheduled (every 10m)');
}

/** Set up the anonymous owner + agent for anonymous mode. Normal auth still works alongside. */
async function setupAnonymousIdentity(config: AimeatConfig, storage: Storage): Promise<void> {
  const ANON_OWNER = 'anonymous';
  const ANON_AGENT_NAME = 'shared';
  const ANON_GAII = `${ANON_AGENT_NAME}#${ANON_OWNER}@${config.nodeId}`;

  try {
    // Create anonymous owner if doesn't exist
    let owner = await storage.getOwner(ANON_OWNER);
    if (!owner) {
      const kp = await generateKeyPair();
      await storage.createOwner({
        name: ANON_OWNER,
        displayName: 'Anonymous Node',
        publicKey: kp.publicKey,
        roles: ['owner'],
        createdAt: new Date().toISOString(),
      });
      logger.info('Anonymous owner created');
    }

    // Create anonymous agent if doesn't exist
    let agent = await storage.getAgent(ANON_GAII);
    if (!agent) {
      const kp = await generateKeyPair();
      await storage.createAgent({
        name: ANON_AGENT_NAME,
        owner: ANON_OWNER,
        gaii: ANON_GAII,
        displayName: 'Shared Anonymous Agent',
        description: 'Shared agent for anonymous mode — all AI agents share this identity and memory space',
        capabilities: ['memory', 'micro-memory', 'actions', 'catalogue'],
        publicKey: kp.publicKey,
        trustScore: 50,
        morselBalance: config.welcomeBonus,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
      logger.info('Anonymous agent created', { gaii: ANON_GAII });
    }

    // Enable the anonymous auth fallback in middleware
    enableAnonymousAuth(ANON_GAII, ANON_OWNER);
    logger.info('Anonymous mode enabled — unauthenticated requests use shared identity', { gaii: ANON_GAII });
  } catch (err) {
    logger.error('Failed to setup anonymous identity', { error: err });
  }
}

async function initializeNode(config: AimeatConfig, storage: Storage): Promise<void> {
  try {
    let nodeKey = await storage.getNodeKey();
    if (!nodeKey) {
      // I-3: Try loading persisted key from ~/.aimeat/node-key.json
      nodeKey = loadPersistedNodeKey();
      if (nodeKey) {
        await storage.setNodeKey(nodeKey.publicKey, nodeKey.privateKey);
        logger.info('Node key loaded from ~/.aimeat/node-key.json');
      } else {
        logger.info('Generating node keypair...');
        const kp = await generateKeyPair();
        await storage.setNodeKey(kp.publicKey, kp.privateKey);
        nodeKey = kp;
        persistNodeKey(kp);
        logger.info('Node keypair generated and saved to ~/.aimeat/node-key.json');
      }
    }
    await initNodeKeys(nodeKey.publicKey, nodeKey.privateKey);
    logger.info('Node keys initialized for JWT signing');
  } catch (err) {
    logger.error('Failed to initialize node keys', { error: err });
  }
}

function getNodeKeyPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return join(home, '.aimeat', 'node-key.json');
}

function loadPersistedNodeKey(): { publicKey: string; privateKey: string } | null {
  const keyPath = getNodeKeyPath();
  try {
    if (!existsSync(keyPath)) return null;
    const data = JSON.parse(readFileSync(keyPath, 'utf-8'));
    if (data.publicKey && data.privateKey) return data;
    return null;
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function maintenancePageHtml(nodeId: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="30"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>Maintenance — ${esc(nodeId)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1025;color:#f0e6ff;font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;padding:20px;overflow:hidden}

/* ── Warm ambient gradient base ── */
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(168,85,247,.12) 0%,transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(236,72,153,.1) 0%,transparent 50%),radial-gradient(ellipse at 50% 50%,rgba(139,92,246,.06) 0%,transparent 70%);z-index:0}

/* ── PS-style flowing waves — warm and bright ── */
.waves{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.wave{position:absolute;width:200%;height:200%;border-radius:42%;animation:drift linear infinite}
.wave:nth-child(1){background:linear-gradient(135deg,#c084fc,#f472b6,#fb923c);top:-60%;left:-50%;animation-duration:25s;opacity:.07}
.wave:nth-child(2){background:linear-gradient(225deg,#a78bfa,#f9a8d4,#fdba74);top:-65%;left:-55%;animation-duration:30s;animation-delay:-5s;opacity:.06}
.wave:nth-child(3){background:linear-gradient(315deg,#e879f9,#fb7185,#c084fc);top:-70%;left:-45%;animation-duration:35s;animation-delay:-10s;opacity:.05}
.wave:nth-child(4){background:linear-gradient(45deg,#f0abfc,#fda4af,#d8b4fe);top:-55%;left:-60%;animation-duration:40s;animation-delay:-15s;opacity:.04}
@keyframes drift{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

/* ── Floating hearts + particles ── */
.particles{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.particle{position:absolute;opacity:0;animation:float linear infinite}
.particle.dot{border-radius:50%}
.particle.heart::before{content:'\\2665';font-size:inherit;color:inherit}
.particle:nth-child(1){font-size:14px;color:rgba(244,114,182,.5);left:8%;animation-duration:14s;animation-delay:0s}
.particle:nth-child(2){width:3px;height:3px;background:#c084fc;left:20%;animation-duration:16s;animation-delay:-2s}
.particle:nth-child(3){font-size:10px;color:rgba(192,132,252,.4);left:35%;animation-duration:12s;animation-delay:-5s}
.particle:nth-child(4){width:2px;height:2px;background:#f9a8d4;left:48%;animation-duration:18s;animation-delay:-3s}
.particle:nth-child(5){font-size:16px;color:rgba(251,113,133,.4);left:62%;animation-duration:15s;animation-delay:-7s}
.particle:nth-child(6){width:3px;height:3px;background:#fda4af;left:75%;animation-duration:13s;animation-delay:-1s}
.particle:nth-child(7){font-size:12px;color:rgba(216,180,254,.4);left:88%;animation-duration:17s;animation-delay:-9s}
.particle:nth-child(8){width:2px;height:2px;background:#f0abfc;left:50%;animation-duration:20s;animation-delay:-11s}
.particle:nth-child(9){font-size:8px;color:rgba(249,168,212,.35);left:15%;animation-duration:19s;animation-delay:-6s}
.particle:nth-child(10){width:4px;height:4px;background:rgba(244,114,182,.3);left:42%;animation-duration:11s;animation-delay:-4s}
@keyframes float{0%{transform:translateY(100vh) scale(0);opacity:0}10%{opacity:.7}90%{opacity:.7}100%{transform:translateY(-10vh) scale(1);opacity:0}}

/* ── Card ── */
.card{position:relative;z-index:1;background:rgba(30,20,45,.65);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(192,132,252,.2);border-radius:28px;padding:56px 48px;max-width:520px;width:100%;text-align:center;box-shadow:0 0 100px rgba(168,85,247,.1),0 0 40px rgba(236,72,153,.06),0 4px 32px rgba(0,0,0,.2);animation:cardIn .8s cubic-bezier(.16,1,.3,1)}
@keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}

/* ── Heart-beat loader ── */
.loader{position:relative;width:80px;height:80px;margin:0 auto 28px}
.heart-icon{font-size:40px;line-height:80px;animation:heartbeat 1.6s ease-in-out infinite;filter:drop-shadow(0 0 12px rgba(244,114,182,.4))}
@keyframes heartbeat{0%,100%{transform:scale(1)}14%{transform:scale(1.15)}28%{transform:scale(1)}42%{transform:scale(1.1)}56%{transform:scale(1)}}
.loader-ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent}
.loader-ring:nth-child(1){border-top-color:rgba(192,132,252,.5);animation:spin 3s linear infinite}
.loader-ring:nth-child(2){inset:4px;border-right-color:rgba(244,114,182,.4);animation:spin 4s linear infinite reverse}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Brand ── */
.brand{font-size:.85rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px;color:rgba(216,180,254,.6)}
h1{font-size:1.6rem;font-weight:700;margin-bottom:14px;background:linear-gradient(135deg,#f0abfc,#f9a8d4,#fda4af);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.01em}
.msg{color:#c4b5d4;font-size:1rem;margin-bottom:28px;line-height:1.7}
.reason{background:rgba(192,132,252,.08);border:1px solid rgba(192,132,252,.18);border-radius:12px;padding:14px 20px;color:#d8b4fe;font-size:.9rem;margin-bottom:28px;letter-spacing:.01em}
.node-id{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 16px;margin-bottom:20px}
.node-id code{color:#a78bfa;font-family:'SF Mono',Consolas,monospace;font-size:.75rem}
.status-dot{width:7px;height:7px;border-radius:50%;background:#f472b6;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(244,114,182,.5)}50%{opacity:.6;box-shadow:0 0 0 8px rgba(244,114,182,0)}}
.footer{color:rgba(167,139,250,.4);font-size:.7rem;margin-top:8px;letter-spacing:.04em;text-transform:uppercase}

/* ── Progress bar — warm gradient ── */
.progress{width:100%;height:3px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:24px;overflow:hidden}
.progress-bar{height:100%;width:100%;background:linear-gradient(90deg,#c084fc,#f472b6,#fb923c,#c084fc);background-size:300% 100%;border-radius:2px;animation:shimmer 2.5s linear infinite}
@keyframes shimmer{from{background-position:300% 0}to{background-position:0 0}}

/* ── Tagline ── */
.tagline{position:relative;z-index:1;margin-top:24px;font-size:.75rem;color:rgba(216,180,254,.3);letter-spacing:.08em}
</style></head><body>

<!-- PS-style flowing waves -->
<div class="waves">
<div class="wave"></div>
<div class="wave"></div>
<div class="wave"></div>
<div class="wave"></div>
</div>

<!-- Floating hearts + particles -->
<div class="particles">
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
<div class="particle heart"></div>
<div class="particle dot"></div>
</div>

<div class="card">
  <!-- Heart-beat loader with orbiting rings -->
  <div class="loader">
    <div class="loader-ring"></div>
    <div class="loader-ring"></div>
    <div class="heart-icon">&#x2665;</div>
  </div>

  <p class="brand">AIME AT</p>
  <h1>We'll Be Right Back</h1>
  <p class="msg">Making things even better for you.<br>This won't take long.</p>
  ${message ? `<div class="reason">${esc(message)}</div>` : ''}

  <div class="node-id">
    <span class="status-dot"></span>
    <code>${esc(nodeId)}</code>
  </div>

  <div class="progress"><div class="progress-bar"></div></div>
  <p class="footer">Auto-refreshes every 30 seconds</p>
</div>

<p class="tagline">AI Memory Exchange &amp; Action Transfer</p>
</body></html>`;
}

function persistNodeKey(kp: { publicKey: string; privateKey: string }): void {
  const keyPath = getNodeKeyPath();
  try {
    const dir = dirname(keyPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(keyPath, JSON.stringify({ publicKey: kp.publicKey, privateKey: kp.privateKey }, null, 2) + '\n', { mode: 0o600 });
  } catch (err) {
    logger.warn('Could not persist node key', { path: keyPath, error: err });
  }
}
