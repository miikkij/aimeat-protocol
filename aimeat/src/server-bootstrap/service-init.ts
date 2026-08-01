/**
 * @file service-init.ts
 * @description Server bootstrap step that initializes runtime services after
 *   storage is ready: scheduler + core job handlers, federation heartbeat/peer
 *   recovery, directory indexing, personal-node tunnels, anonymous mode, mailbox
 *   push, and one-shot data seeding/hygiene jobs (profile/CSM/knowledge/prompt/
 *   cortex seeds, legacy app ownerName normalization).
 * @structure initializeServices() — wires all of the above and returns the
 *   shared service handles consumed by route mounting.
 * @usage const services = await initializeServices(config, storage);
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial service bootstrap extraction
 *   v1.1.0 — 2026-06-05 — Run storage.normalizeAppOwnerNames() at startup to
 *     reunite agent-published apps with the owner's "Published Apps".
 *   v1.2.0 — 2026-06-09 — Chain storage.mergeForkedAppBuckets() after the
 *     ownerName normalization to consolidate forked ownerGaii app buckets.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MaintenanceState } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import { generateKeyPair } from '../auth/keypair.js';
import { enableAnonymousAuth } from '../auth/middleware.js';
import { startHeartbeatJob, setOnPeerRecovery } from '../services/federation.js';
import { startScreenshotAutoCapture } from '../services/screenshot-capture.js';
import { presence } from '../services/presence.js';
import { assembleBook, pullBook } from '../services/federation-book.js';
import { performKeyExchange } from '../routes/federation.js';
import { TunnelManager } from '../services/personal-tunnel.js';
import { ConnectTunnelManager, setActiveConnectTunnelManager } from '../services/connect-tunnel.js';
import { seedProfileSchemas } from '../services/profile-schemas.js';
import { seedCsmTemplates } from '../services/csm-seed.js';
import { seedManifestSchema } from '../services/manifest-schema.js';
import { seedTemplateBundles } from '../services/template-bundles.js';
import { seedKnowledgeTemplates } from '../services/knowledge.js';
import { seedSystemPrompts } from '../services/prompt-seeder.js';
import { seedBundledCortexes } from '../services/cortex-seeder.js';
import { seedExamplePackages } from '../services/package-seeder.js';
import { seedBuiltinSkills } from '../services/skill-seeds.js';
import { DirectoryService } from '../services/directory.js';
import { RealtimeManager } from '../services/realtime-manager.js';
import { MailboxNotificationService } from '../services/mailbox-notification.js';
import { Scheduler, setActiveScheduler } from '../services/scheduler.js';
import { WorkflowEngine, setActiveWorkflowEngine } from '../services/workflow/engine.js';
import { createEmailService, setActiveEmailService } from '../services/email.js';
import { enqueueCatalogueSync } from '../services/catalogue-sync.js';
import { initializeNode } from '../auth/node-keys.js';
import { logger } from '../utils/logger.js';
import { sweepLapsedMemberships } from '../services/app-member-sweep.js';
import { sweepUndisclosedPublicContent } from '../services/ai-disclosure-sweep.js';
import { registerCoreHandlers } from '../services/core-jobs.js';

export interface ServiceInitResult {
  maintenanceCache: MaintenanceState;
  setMaintenanceCache: (state: MaintenanceState) => void;
  directoryService: DirectoryService;
  peers: Map<string, PeerInfo>;
  networkDirectory: Map<string, ServiceSummary>;
  realtimeManager: RealtimeManager | null;
  tunnelManager: TunnelManager | null;
  connectTunnelManager: ConnectTunnelManager | null;
  mailboxNotificationService: MailboxNotificationService | null;
  scheduler: Scheduler;
  workflowEngine: WorkflowEngine;
}

/**
 * Initialize all services: scheduler, federation, directory, personal nodes,
 * anonymous mode, seeding, and more.
 */
export async function initializeServices(
  config: AimeatConfig,
  storage: Storage,
): Promise<ServiceInitResult> {
  // Maintenance mode cache — loaded once from storage, updated on toggle
  let maintenanceCache: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };
  try {
    maintenanceCache = await storage.getMaintenanceMode();
  } catch (err) { logger.warn('initializeServices: default to disabled', { error: String(err) }); }

  // Initialize node keys asynchronously
  initializeNode(config, storage);

  // Anonymous mode: auto-create anonymous owner + agent if not already present
  if (config.anonymousMode) {
    await setupAnonymousIdentity(config, storage);
  }

  // Internal Scheduler System — centralized cron-based job scheduler
  const emailService = createEmailService(config);
  setActiveEmailService(emailService);
  const scheduler = new Scheduler(config, storage, emailService);
  setActiveScheduler(scheduler);

  // Agent Workflows engine — the deterministic run loop; advanced by the scheduler (kind 'workflow'),
  // task-terminal events (agent-tasks route), and its own watchdog sweep.
  const workflowEngine = new WorkflowEngine(config, storage);
  setActiveWorkflowEngine(workflowEngine);

  // Register core job handlers
  registerCoreHandlers(scheduler, config, storage);

  // Seed standardized profile schemas — Phase 0.4
  seedProfileSchemas(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Seeded ${count} profile schemas`); })
    .catch(err => logger.error('Failed to seed profile schemas', { error: err }));

  // Seed CSM template schemas from docs/csm-examples/ — Phase 0.2
  seedCsmTemplates(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Seeded ${count} CSM schemas`); })
    .catch(err => logger.error('Failed to seed CSM schemas', { error: err }));

  // Seed the generic manifest-format schema (organism.*.meta.manifest) — Phase 3
  seedManifestSchema(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info('Seeded manifest-format schema'); })
    .catch(err => logger.error('Failed to seed manifest schema', { error: err }));

  // Seed organism template bundles (project object-type CSMs) globally — Phase 3
  seedTemplateBundles(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Seeded ${count} template-bundle CSMs`); })
    .catch(err => logger.error('Failed to seed template bundles', { error: err }));

  // Seed knowledge packager prompt templates
  seedKnowledgeTemplates(storage, `system@${config.nodeId}`)
    .then(() => logger.info('Knowledge prompt templates seeded'))
    .catch(err => logger.error('Failed to seed knowledge templates', { error: err }));

  seedSystemPrompts(storage)
    .then(() => {})
    .catch(err => logger.error('Failed to seed system prompts', { error: String(err) }));

  // Seed built-in node-scope skills (operator + user runbooks) — create-if-missing,
  // operator edits never overwritten.
  seedBuiltinSkills(storage, config)
    .then(count => { if (count > 0) logger.info(`Seeded ${count} built-in skill(s)`); })
    .catch(err => logger.error('Failed to seed built-in skills', { error: String(err) }));

  // Auto-install bundled cortex extensions (aimeat-ui-*, aimeat-canvas, aimeat-charts)
  seedBundledCortexes(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Auto-installed ${count} bundled cortex extensions`); })
    .catch(err => logger.error('Failed to seed bundled cortexes', { error: String(err) }));

  // Auto-seed bundled example packages (digital-signage, aimeat-iam, …) into the catalog so
  // every user can install them without an operator running `aimeat seed`. Idempotent.
  seedExamplePackages(storage, `system@${config.nodeId}`)
    .then(count => { if (count > 0) logger.info(`Auto-seeded ${count} example package(s)`); })
    .catch(err => logger.error('Failed to seed example packages', { error: String(err) }));

  // Data hygiene: legacy publish paths stored app ownerName as the full GHII
  // (owner@node). The catalog "my apps" filter and the by-owner-name delete
  // sweep both key on the bare name, so those rows were stranded as
  // unmanageable "community" apps. Normalize them to the bare owner name (idempotent).
  storage.normalizeAppOwnerNames()
    .then(count => { if (count > 0) logger.info(`Normalized ${count} legacy app ownerName row(s) to bare owner names`); })
    // After ownerName is bare, fold any ownerGaii buckets the same owner forked
    // across identity forms (dashboard bare name vs MCP/PAT full GHII) into one
    // canonical record so publishes from any identity update the same app.
    .then(() => storage.mergeForkedAppBuckets())
    .then(count => { if (count && count > 0) logger.info(`Merged ${count} forked app bucket row(s) into canonical owner buckets`); })
    .catch(err => logger.error('Failed to normalize/merge app owner buckets', { error: String(err) }));

  // Directory service — Phase 1.4 (indexes GHII profiles for local + thematic search)
  const directoryService = new DirectoryService(config, storage);
  directoryService.rebuildIndex()
    .then(() => logger.info('Directory index built'))
    .catch(err => logger.error('Failed to build directory index', { error: String(err) }));

  // Federation peer registry (shared between routes and heartbeat)
  const peers = new Map<string, PeerInfo>();

  // Network directory — aggregated service summaries from federation peers
  const networkDirectory = new Map<string, ServiceSummary>();

  // Load persisted peers from storage
  try {
    const savedPeers = await storage.listFederationPeers();
    for (const sp of savedPeers) {
      peers.set(sp.nodeId, {
        nodeId: sp.nodeId,
        url: sp.url,
        publicKey: sp.publicKey,
        status: sp.status,
        addedAt: sp.addedAt,
        lastSeen: sp.lastSeen,
        shareCatalogue: sp.shareCatalogue ?? true,
        replicateMemory: sp.replicateMemory ?? true,
        allowRouting: sp.allowRouting ?? true,
        peerMode: sp.peerMode || 'federation',
        allowFederatedAuth: sp.allowFederatedAuth ?? false,
        federationAuthScopes: sp.federationAuthScopes ?? [],
        tier: sp.tier ?? 'member',
        availability: sp.availability ?? undefined,
        expiresAt: sp.expiresAt ?? null,
        heartbeatOk: sp.heartbeatOk ?? 0,
        heartbeatTotal: sp.heartbeatTotal ?? 0,
        availabilityWindow: sp.availabilityWindow ?? null,
        availabilityPct: sp.availabilityPct ?? null,
        softwareVersion: sp.softwareVersion ?? null,
        nodeCardHash: sp.nodeCardHash ?? null,
      });
    }
    if (savedPeers.length > 0) {
      logger.info(`Loaded ${savedPeers.length} persisted federation peers`);
    }
  } catch (err) {
    logger.error('Failed to load persisted peers', { error: String(err) });
  }

  // Start federation heartbeat job (signed heartbeats with catalogue hash, jittered scheduling)
  startHeartbeatJob(config, storage, peers, networkDirectory);

  // Node-internal auto-screenshot job — backfills app thumbnails with no token/operator action
  // (no-op unless config.screenshotAutoCapture is on; self-disables if no browser is available).
  startScreenshotAutoCapture(config, storage);

  // Presence tracker — local online state (from SSE) + federated remote cache, with a
  // change-driven push loop (≤1/min) to active peers. Reads always resolve locally.
  presence.init(config, storage, peers);

  // Federation book — the primary (genesis/anchor, no genesisUrl) assembles the book of operator
  // GHIIs + resources from its peers' node-cards; leaf nodes mirror it by pulling from their genesis.
  // Runs on a low-frequency timer; manual rebuild/pull endpoints exist too.
  if (config.crossFederationEnabled !== false) {
    const isPrimary = !config.genesisUrl;
    const BOOK_INTERVAL_MS = 120_000;
    const tick = () => {
      if (isPrimary) {
        assembleBook(config, storage, peers).catch(err => logger.warn('Federation book assembly failed', { error: String(err) }));
      } else {
        pullBook(config, storage, peers).then(r => {
          if (r.applied) logger.info('Federation book mirrored from genesis', { version: r.book_version });
        }).catch(err => logger.warn('Federation book pull failed', { error: String(err) }));
      }
    };
    setTimeout(tick, 15_000); // initial run shortly after boot
    setInterval(tick, BOOK_INTERVAL_MS);
  }

  // Take the free access back when an app membership term runs out. Access itself already stops on
  // the clock — a lapsed member is refused on their next call — but the EXCHANGE grants have to be
  // withdrawn by something, and until they are, somebody the provider stopped selling to is still
  // calling on the provider's money. Hourly is fine: the money leak is bounded by the interval, and
  // the access leak does not exist.
  {
    const SWEEP_INTERVAL_MS = 3_600_000;
    const sweep = () => {
      sweepLapsedMemberships(storage, config)
        .catch(err => logger.warn('app-member sweep failed', { error: String(err) }));
    };
    setTimeout(sweep, 45_000); // once shortly after boot, so a restart closes anything overdue
    setInterval(sweep, SWEEP_INTERVAL_MS);
  }

  // TARGET-058: the mechanism that catches the case nobody thought of. Every other gate in that
  // programme protects a path somebody has already considered; this one asks the database whether
  // any publicly readable item exists that a model wrote, nobody reviewed, and nothing labelled —
  // and tells the account that published it. Phases 4, 5 and 6 each found a door that had been
  // missed, so looking for the OUTCOME rather than for a known route is what keeps working when the
  // next door appears. Six-hourly: the window is two days, so nothing falls between sweeps, and a
  // person who publishes a lot is told once rather than nagged.
  {
    const DISCLOSURE_SWEEP_MS = 6 * 3_600_000;
    const disclosureSweep = () => {
      sweepUndisclosedPublicContent(storage, config)
        .catch(err => logger.warn('ai-disclosure sweep failed', { error: String(err) }));
    };
    setTimeout(disclosureSweep, 90_000);
    setInterval(disclosureSweep, DISCLOSURE_SWEEP_MS);
  }

  // A.4: Wire peer recovery to key exchange + future full sync
  setOnPeerRecovery((peerId: string) => {
    const peer = peers.get(peerId);
    if (!peer) return;

    // Re-exchange keys with the recovered peer
    performKeyExchange(peer.url, config, storage)
      .then(result => {
        if (result.success) {
          logger.info(`Key exchange completed after recovery of peer ${peer.nodeId}`);
        } else {
          logger.warn(`Key exchange failed after recovery of peer ${peer.nodeId}: ${result.error}`);
        }
      })
      .catch(err => {
        logger.error(`Key exchange error after recovery of peer ${peer.nodeId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Phase B: Queue full catalogue sync for recovered peer
    enqueueCatalogueSync(peerId, config, storage)
      .then(() => logger.info(`Full catalogue sync queued for recovered peer ${peer.nodeId}`))
      .catch(err => logger.warn(`Failed to queue sync for recovered peer ${peer.nodeId}`, {
        error: err instanceof Error ? err.message : String(err),
      }));
  });

  // Realtime manager forward-declaration (initialized after route mounting)
  const realtimeManager: RealtimeManager | null = null;

  // Personal Node tunnel manager (operator-side)
  let tunnelManager: TunnelManager | null = null;
  if (config.personalNodesEnabled && config.nodeType === 'full') {
    tunnelManager = new TunnelManager(config, storage);
    tunnelManager.startHeartbeatMonitor();
    logger.info('Personal node support enabled', { maxSlots: config.personalNodeMaxSlots });
  }

  // Connector Forward Tunnel manager — one persistent WS per agent identity for
  // forward API calls + realtime reverse delivery. Decoupled from personal nodes.
  let connectTunnelManager: ConnectTunnelManager | null = null;
  if (config.connectTunnelEnabled) {
    connectTunnelManager = new ConnectTunnelManager(config, storage);
    connectTunnelManager.startHeartbeatMonitor();
    setActiveConnectTunnelManager(connectTunnelManager);
    logger.info('Connector forward tunnel enabled');
  }

  // Mailbox push notification service (REQ-007)
  let mailboxNotificationService: MailboxNotificationService | null = null;
  if (config.personalNodesEnabled && config.pushEnabled && config.vapidPublicKey && config.vapidPrivateKey) {
    mailboxNotificationService = new MailboxNotificationService(config, storage);
    logger.info('Mailbox push notification service initialized');
  }

  // Wire notification service to tunnel manager for cooldown clearing on reconnect (REQ-007)
  if (tunnelManager && mailboxNotificationService) {
    tunnelManager.setNotificationService(mailboxNotificationService);
  }

  return {
    maintenanceCache,
    setMaintenanceCache: (state: MaintenanceState) => { Object.assign(maintenanceCache, state); },
    directoryService,
    peers,
    networkDirectory,
    realtimeManager,
    tunnelManager,
    connectTunnelManager,
    mailboxNotificationService,
    scheduler,
    workflowEngine,
  };
}

/** Set up the anonymous owner + agent + GHII for anonymous mode. Normal auth still works alongside. */
async function setupAnonymousIdentity(config: AimeatConfig, storage: Storage): Promise<void> {
  const ANON_OWNER = 'anonymous';
  const ANON_AGENT_NAME = 'shared';
  const ANON_GAII = `${ANON_AGENT_NAME}#${ANON_OWNER}@${config.nodeId}`;

  try {
    // Create anonymous owner if doesn't exist
    const owner = await storage.getOwner(ANON_OWNER);
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
    const agent = await storage.getAgent(ANON_GAII);
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

    // Create anonymous GHII if doesn't exist — system identity for anonymous chat sessions
    const ANON_GHII = `${ANON_OWNER}@${config.nodeId}`;
    const existingGhii = await storage.getGHII(ANON_GHII);
    if (!existingGhii) {
      const now = new Date().toISOString();
      await storage.createGHII({
        username: ANON_OWNER,
        nodeId: config.nodeId,
        ghii: ANON_GHII,
        displayName: 'Anonymous',
        verificationLevel: 0,
        ownerName: ANON_OWNER,
        totpEnabled: false,
        trustScore: 50,
        morselBalance: 0,
        createdAt: now,
        updatedAt: now,
      });
      logger.info('Anonymous GHII created', { ghii: ANON_GHII });
    }

    // Enable the anonymous auth fallback in middleware
    enableAnonymousAuth(ANON_GAII, ANON_OWNER);
    logger.info('Anonymous mode enabled — unauthenticated requests use shared identity', { gaii: ANON_GAII });
  } catch (err) {
    logger.error('Failed to setup anonymous identity', { error: err });
  }
}
