import type { AimeatConfig } from '../config.js';
import type { Storage, MaintenanceState } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { generateKeyPair } from '../auth/keypair.js';
import { enableAnonymousAuth } from '../auth/middleware.js';
import { startHeartbeatJob, setOnPeerRecovery } from '../services/federation.js';
import { performKeyExchange } from '../routes/federation.js';
import { TunnelManager } from '../services/personal-tunnel.js';
import { seedProfileSchemas } from '../services/profile-schemas.js';
import { seedCsmTemplates } from '../services/csm-seed.js';
import { seedKnowledgeTemplates } from '../services/knowledge.js';
import { seedSystemPrompts } from '../services/prompt-seeder.js';
import { DirectoryService } from '../services/directory.js';
import { RealtimeManager } from '../services/realtime-manager.js';
import { MailboxNotificationService } from '../services/mailbox-notification.js';
import { Scheduler } from '../services/scheduler.js';
import { enqueueCatalogueSync } from '../services/catalogue-sync.js';
import { initializeNode } from '../auth/node-keys.js';
import { logger } from '../utils/logger.js';
import { registerCoreHandlers } from '../services/core-jobs.js';

export interface ServiceInitResult {
  maintenanceCache: MaintenanceState;
  setMaintenanceCache: (state: MaintenanceState) => void;
  directoryService: DirectoryService;
  peers: Map<string, PeerInfo>;
  realtimeManager: RealtimeManager | null;
  tunnelManager: TunnelManager | null;
  mailboxNotificationService: MailboxNotificationService | null;
  scheduler: Scheduler;
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
  } catch { /* default to disabled */ }

  // Initialize node keys asynchronously
  initializeNode(config, storage);

  // Anonymous mode: auto-create anonymous owner + agent if not already present
  if (config.anonymousMode) {
    await setupAnonymousIdentity(config, storage);
  }

  // Internal Scheduler System — centralized cron-based job scheduler
  const scheduler = new Scheduler(config, storage);

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

  // Seed knowledge packager prompt templates
  seedKnowledgeTemplates(storage, `system@${config.nodeId}`)
    .then(() => logger.info('Knowledge prompt templates seeded'))
    .catch(err => logger.error('Failed to seed knowledge templates', { error: err }));

  seedSystemPrompts(storage)
    .then(() => {})
    .catch(err => logger.error('Failed to seed system prompts', { error: String(err) }));

  // Directory service — Phase 1.4 (indexes GHII profiles for local + thematic search)
  const directoryService = new DirectoryService(config, storage);
  directoryService.rebuildIndex()
    .then(() => logger.info('Directory index built'))
    .catch(err => logger.error('Failed to build directory index', { error: String(err) }));

  // Federation peer registry (shared between routes and heartbeat)
  const peers = new Map<string, PeerInfo>();

  // Start federation heartbeat job (signed heartbeats with catalogue hash, jittered scheduling)
  startHeartbeatJob(config, storage, peers);

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
  let realtimeManager: RealtimeManager | null = null;

  // Personal Node tunnel manager (operator-side)
  let tunnelManager: TunnelManager | null = null;
  if (config.personalNodesEnabled && config.nodeType === 'full') {
    tunnelManager = new TunnelManager(config, storage);
    tunnelManager.startHeartbeatMonitor();
    logger.info('Personal node support enabled', { maxSlots: config.personalNodeMaxSlots });
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
    setMaintenanceCache: (state: MaintenanceState) => { maintenanceCache = state; },
    directoryService,
    peers,
    realtimeManager,
    tunnelManager,
    mailboxNotificationService,
    scheduler,
  };
}

/** Set up the anonymous owner + agent + GHII for anonymous mode. Normal auth still works alongside. */
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
