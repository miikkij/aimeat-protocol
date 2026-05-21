import express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MaintenanceState } from '../storage/interface.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import type { PeerInfo } from '../services/federation.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import type { DirectoryService } from '../services/directory.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { RealtimeManager } from '../services/realtime-manager.js';
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
import type { Scheduler } from '../services/scheduler.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import { logger } from '../utils/logger.js';

// Routes
import { bootstrapRouter } from '../routes/bootstrap.js';
import { wellknownRouter } from '../routes/wellknown.js';
import { authRouter } from '../routes/auth.js';
import { ownersRouter } from '../routes/owners.js';
import { agentsRouter } from '../routes/agents.js';
import { schemaRouter } from '../routes/schemas.js';
import { consentRouter } from '../routes/consent.js';
import { permissionsRouter } from '../routes/permissions.js';
import { memoryRouter } from '../routes/memory.js';
import { actionsRouter } from '../routes/actions.js';
import { catalogueRouter } from '../routes/catalogue.js';
import { workRouter } from '../routes/work.js';
import { walletRouter } from '../routes/wallet.js';
import { boardsRouter } from '../routes/boards.js';
import { promptsRouter } from '../routes/prompts.js';
import { adminRouter } from '../routes/admin.js';
import { federationRouter } from '../routes/federation.js';
import { organismsRouter } from '../routes/organisms.js';
import { sharingGroupsRouter } from '../routes/sharing-groups.js';
import { specRouter } from '../routes/spec.js';
import { disputesRouter } from '../routes/disputes.js';
import { microMemoryRouter } from '../routes/micro-memory.js';
import { storageFilesRouter } from '../routes/storage-files.js';
import { validateRouter } from '../routes/validate.js';
import { mcpRouter } from '../mcp/index.js';
import { portalRouter } from '../routes/portal.js';
import { portfolioRouter } from '../routes/portfolio.js';
import { portalApiRouter } from '../routes/portal-api.js';
import { csmRouter } from '../routes/csm.js';
import { msmRouter } from '../routes/msm.js';
import { ghiiRouter } from '../routes/ghii.js';
import { chatInstancesRouter } from '../routes/chat-instances.js';
import { totpRouter } from '../routes/totp.js';
import { libsRouter } from '../routes/libs.js';
import { appsRouter } from '../routes/apps.js';
import { appStoreRouter } from '../routes/app-store.js';
import { flagsRouter } from '../routes/flags.js';
import { appealsRouter } from '../routes/appeals.js';
import { matchesRouter } from '../routes/matches.js';
import { personalRouter } from '../routes/personal.js';
import { pushRouter } from '../routes/push.js';
import { verificationRouter } from '../routes/verification.js';
import { knowledgeRouter } from '../routes/knowledge.js';
import { siteRouter } from '../routes/site.js';
import { realtimeRouter } from '../routes/realtime.js';
import { sseRouter } from '../routes/sse.js';
import { adminFeaturesRouter } from '../routes/admin-features.js';
import { setupRouter } from '../routes/setup.js';
import { extensionsRouter } from '../routes/extensions.js';
import { cortexRouter } from '../routes/cortex.js';
import { packagesRouter } from '../routes/packages.js';
import { instancesRouter } from '../routes/instances.js';
import { templatesRouter } from '../routes/templates.js';
import { adminSchedulerRouter } from '../routes/admin-scheduler.js';
import { capabilitiesRouter } from '../routes/capabilities.js';
import { adminCapabilitiesRouter } from '../routes/admin-capabilities.js';
import { adminExtensionsRouter } from '../routes/admin-extensions.js';
import { adminPromptsRouter } from '../routes/admin-prompts.js';
import { statsRouter } from '../routes/stats.js';
import { generatorRouter } from '../routes/generator.js';
import { generatorAutopilotRouter } from '../routes/generator-autopilot.js';
import { foundryRouter } from '../routes/foundry.js';
import { calibratorRouter } from '../routes/calibrator.js';
import { openrouterRouter } from '../routes/openrouter.js';
import { uploadRouter } from '../routes/upload.js';
import { agentTasksRouter } from '../routes/agent-tasks.js';
import { agentIntegrationRouter } from '../routes/agent-integration.js';

// Services needed during route mounting
import { createPushService } from '../services/push.js';
import { createEudiwService } from '../services/eudiw.js';
import { createSdJwtVerifier } from '../services/sd-jwt.js';
import { createOidcClient, type OidcClient } from '../services/oidc-client.js';
import { createDidDocumentService } from '../services/did-document.js';
import { createVcIssuerService } from '../services/vc-issuer.js';
import { createMyDataReceiptService } from '../services/mydata-receipt.js';
import { createEmailService } from '../services/email.js';
import { SiteService } from '../services/site.js';
import { startSiteSyncJob, triggerSiteSync } from '../services/site-sync.js';
import { startMatchNotificationJob } from '../services/match-notification.js';
import { createMatchingEngine, startMatchingScheduler } from '../services/matching.js';
import { createGenesisPeeringService } from '../services/genesis-peering.js';
import { createGenesisSyncService } from '../services/genesis-sync.js';
import { startCacheCleanupJob } from '../services/cache-cleanup.js';
import { startSyncScheduler } from '../services/sync-scheduler.js';
import { initStats } from '../services/stats.js';
import { createMetricsRegistry } from '../services/prometheus.js';
import { statsMiddleware } from '../middleware/stats.js';
import { metricsMiddleware } from '../middleware/metrics.js';
import { seedCoreScheduledJobs } from '../services/job-seeding.js';

export interface MountRoutesOptions {
  rejectForRelay: express.RequestHandler;
  mirrorReadOnly: express.RequestHandler;
  maintenanceState: {
    get: () => MaintenanceState;
    set: (state: MaintenanceState) => void;
  };
  provenance: ConfigProvenance;
  consulService: ConsulConfigService | null;
  directoryService: DirectoryService;
  peers: Map<string, PeerInfo>;
  networkDirectory?: Map<string, ServiceSummary>;
  tunnelManager: TunnelManager | null;
  mailboxNotificationService: MailboxNotificationService | null;
  scheduler: Scheduler;
  invalidateHasOwnersCache: () => void;
}

export interface MountRoutesResult {
  realtimeManager: RealtimeManager | null;
}

/**
 * Mount all 40+ route handlers on the Express app.
 */
export async function mountRoutes(
  app: express.Express,
  config: AimeatConfig,
  storage: Storage,
  opts: MountRoutesOptions,
): Promise<MountRoutesResult> {
  const {
    rejectForRelay, mirrorReadOnly, maintenanceState,
    provenance, consulService, directoryService,
    peers, networkDirectory, tunnelManager, mailboxNotificationService,
    scheduler, invalidateHasOwnersCache,
  } = opts;

  // Statistics collector (with persistence via storage)
  const stats = await initStats(storage);

  // Prometheus metrics registry (opt-in)
  const metricsRegistry = config.metricsEnabled
    ? createMetricsRegistry(config)
    : undefined;

  // Presigned upload endpoint (raw body — no JSON parsing needed)
  app.use(uploadRouter(config, storage));

  // Mount routes
  app.use(setupRouter(config, storage, invalidateHasOwnersCache));
  app.use(bootstrapRouter(config, storage, tunnelManager ?? undefined));
  app.use(statsRouter(config, storage, stats, metricsRegistry));
  app.use(wellknownRouter(config, storage));

  // IndexNow key verification file (serves /{key}.txt for Bing/Yandex)
  if (config.indexNowKey) {
    app.get(`/${config.indexNowKey}.txt`, (_req, res) => {
      res.type('text/plain').send(config.indexNowKey);
    });
  }

  app.use(authRouter(config, storage));
  app.use(sseRouter(config, storage));

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
  // Agent tasks and integration BEFORE agentsRouter to avoid /v1/agents/:name param conflicts
  app.use(agentTasksRouter(config, storage));
  app.use(agentIntegrationRouter(config, storage));
  app.use(agentsRouter(config, storage));
  const notifyDirectoryChange = () => directoryService.notifyChange();
  app.use(consentRouter(config, storage, stats, notifyDirectoryChange));  // Phase 0.3
  app.use(permissionsRouter(config, storage));  // Phase 0.3 — permission listing API
  app.use(schemaRouter(config, storage));  // MUST be before memoryRouter (Phase 0.1)
  app.use('/v1/memory', workspaceAccessMiddleware(config, storage));  // Phase 2.3 — organism workspace access
  app.use(memoryRouter(config, storage, stats, notifyDirectoryChange, peers));
  if (config.generatorEnabled) {
    app.use(generatorRouter(config, storage));   // Agent-driven service generator
    app.use(generatorAutopilotRouter(config, storage)); // Backend autopilot for generator
  }
  if (config.foundryEnabled) {
    app.use(foundryRouter(config, storage));     // Prompt-driven service builder
  }
  if (config.calibratorEnabled) {
    app.use(calibratorRouter(config, storage));  // Prompt calibration tool
  }
  app.use(openrouterRouter(config, storage));   // OpenRouter AI autopilot
  app.use(csmRouter(config, storage));       // Phase 0.2 — CSM management
  app.use(msmRouter(config, storage));        // MSM — Machine Service Manifest
  app.use(actionsRouter(config, storage));
  app.use(catalogueRouter(config, storage, directoryService, () => {
    // realtimeManager may be initialized later; use closure to capture the reference
    return null;
  }));
  app.use(workRouter(config, storage, peers, mailboxNotificationService));
  app.use(walletRouter(config, storage));
  app.use(knowledgeRouter(config, storage));

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
    if (req.path === '/directory' || req.path === '/ping' || req.path === '/heartbeat' || req.path === '/service-summary') return next();
    // Allow federated auth verification (called by remote nodes)
    if (req.path === '/auth/verify' && req.method === 'POST') return next();
    return requireExtended(req, res, next);
  });
  app.use('/v1/storage', requireExtended);
  app.use('/v1/validate', requireExtended);

  app.use(boardsRouter(config, storage));
  app.use(promptsRouter(config, storage));
  app.use(adminRouter(config, storage, maintenanceState, provenance, consulService));
  app.use(organismsRouter(config, storage));
  app.use(sharingGroupsRouter(config, storage));
  app.use(federationRouter(config, storage, peers, networkDirectory));
  app.use(disputesRouter(config, storage));
  app.use(flagsRouter(config, storage));
  app.use(appealsRouter(config, storage));
  app.use(matchesRouter(config, storage));
  app.use(microMemoryRouter(config, storage));
  app.use(storageFilesRouter(config, storage));
  app.use(validateRouter(config));
  app.use(mcpRouter(config, storage));
  const siteService = new SiteService(config, storage);
  app.use(siteRouter(config, storage, siteService));    // Node Portal — GET / + /v1/site/*

  // Site LB sync — manual trigger endpoint + background job
  if (config.siteLbEnabled && config.siteLbOriginUrl) {
    app.post('/v1/admin/site/sync', requireAuth(), requireRole('operator'), async (_req, res) => {
      try {
        const result = await triggerSiteSync(config, storage, siteService);
        res.json(success(config.nodeId, { synced: true, template_updated: result.templateUpdated, memory_keys_synced: result.memoryKeysSynced }));
      } catch (err) {
        res.status(502).json(error(config.nodeId, 'SYNC_FAILED', err instanceof Error ? err.message : 'Sync failed'));
      }
    });
    startSiteSyncJob(config, storage, siteService);
  }
  if (config.portfolioEnabled) {
    app.use(portfolioRouter(config, storage));
  }
  app.use(portalRouter(config, storage));
  app.use(portalApiRouter(config, storage));
  // Phase 1.1 — Email service for verification and magic links
  const emailService = createEmailService(config);

  // Push notification service — Phase 3.1
  const pushService = createPushService(config, storage);
  app.use(pushRouter(config, storage, pushService));

  // EUDIW / VC / MyData services — Phase 3.3
  const sdJwtVerifier = createSdJwtVerifier();
  const eudiwService = createEudiwService(config, storage, sdJwtVerifier);
  const vcIssuerService = createVcIssuerService(config);
  const mydataReceiptService = createMyDataReceiptService(config);

  // FTN OIDC client — Phase 3.3
  let oidcClient: OidcClient | null = null;
  if (config.ftnEnabled && config.ftnProviderUrl && config.ftnClientId) {
    oidcClient = createOidcClient({
      issuerUrl: config.ftnProviderUrl,
      clientId: config.ftnClientId,
      clientSecret: config.ftnClientSecret,
      redirectUri: `${config.baseUrl}/v1/ghii/verify/ftn/callback`,
      scopes: ['openid', 'profile', config.nationalEidPidClaim],
    });
    oidcClient.initialize().catch(err =>
      logger.warn('FTN OIDC discovery failed, FTN endpoints will return 503', { error: String(err) }));
  }

  app.use(verificationRouter(config, storage, eudiwService, vcIssuerService, mydataReceiptService, oidcClient));

  // DID Document + VC signing key — Phase 3.3
  // Node key is loaded async; once available, enable VC signing and serve DID Document
  storage.getNodeKey().then(async (nodeKeyPair) => {
    if (!nodeKeyPair) return;
    vcIssuerService.setNodeKeyPair(nodeKeyPair);
    const publicJwk = await vcIssuerService.getPublicJwk();
    const didDocService = createDidDocumentService(vcIssuerService.getIssuerDid(), publicJwk);
    app.get('/.well-known/did.json', (_req, res) => {
      res.json(didDocService.getDocument());
    });
  }).catch(err => logger.warn('DID Document setup failed', { error: String(err) }));

  // Match notification job — Phase 1.6
  startMatchNotificationJob(config, storage, emailService, directoryService);

  // AI Matching — Phase 2.1
  const matchingEngine = createMatchingEngine(config, storage, directoryService, emailService);
  startMatchingScheduler(config, matchingEngine);

  // Genesis peering service — Phase 3.4
  const genesisPeeringService = createGenesisPeeringService(config, storage);

  // Admin features — Phase 1-3 dashboard endpoints
  app.use(adminFeaturesRouter(config, storage, {
    emailService,
    directoryService,
    matchingEngine,
    pushService,
    genesisPeeringService,
  }));

  app.use(totpRouter(config, storage));   // Phase 0.5 — MUST be before ghiiRouter (TOTP routes use /v1/ghii/totp/*)
  app.use(ghiiRouter(config, storage, emailService, notifyDirectoryChange, peers));
  app.use(chatInstancesRouter(config, storage));
  app.use(libsRouter(config, storage));
  app.use(appsRouter(config, storage, peers));
  app.use(appStoreRouter(config, storage));
  // Node Extensions (Sandboxed)
  if (config.extensionsEnabled) {
    app.use(extensionsRouter(config, storage, scheduler, emailService));
    logger.info('Extension system enabled');
  }

  // Cortex Extensions (Manifest-based)
  if (config.cortexEnabled) {
    app.use(cortexRouter(config, storage));
    logger.info('Cortex extension system enabled');
  }

  // Packages, Instances & Templates
  if (config.packagesEnabled) {
    app.use(packagesRouter(config, storage));
    app.use(instancesRouter(config, storage));
  }
  if (config.packagesEnabled && config.templatesEnabled) {
    app.use(templatesRouter(config, storage));
  }

  // Capability Layer
  app.use(capabilitiesRouter(config, storage));
  app.use(adminCapabilitiesRouter(config, storage));

  // Scheduler admin routes
  app.use(adminSchedulerRouter(config, storage, scheduler));

  // Bundled extensions admin routes
  app.use(adminExtensionsRouter(config, storage, scheduler));

  // System prompts admin routes
  app.use(adminPromptsRouter(config, storage));

  // Seed core scheduled jobs (idempotent — only creates if not already present)
  seedCoreScheduledJobs(config, storage).catch(err =>
    logger.error('Failed to seed core scheduled jobs', { error: String(err) }));

  // Start the scheduler (loads enabled jobs from storage)
  scheduler.start().catch(err => logger.error('Scheduler start failed', { error: String(err) }));

  // Genesis Sync Scheduler (Phase 3.4)
  const genesisSyncService = createGenesisSyncService(config, storage);
  if (genesisSyncService) {
    genesisSyncService.start();
  }

  // Cache Cleanup Scheduler (G.1) — prunes expired federated/replica/genesis memory entries hourly
  startCacheCleanupJob(config, storage);

  // Sync Scheduler (B.4) — coordinates catalogue sync + memory replication based on syncMode
  startSyncScheduler(config, storage, peers);

  app.use(specRouter());

  // Personal node management routes
  if (config.personalNodesEnabled) {
    app.use(personalRouter(config, storage, tunnelManager, mailboxNotificationService));
  }

  // Realtime P2P rooms — Phase 0
  let realtimeManager: RealtimeManager | null = null;
  if (config.realtimeEnabled) {
    realtimeManager = new RealtimeManager(config, storage);
    app.use(realtimeRouter(config, storage, realtimeManager, peers));
    realtimeManager.startCleanupJob();
    logger.info('Realtime P2P rooms enabled', { maxRooms: config.realtimeMaxRooms });
  }

  return { realtimeManager };
}
