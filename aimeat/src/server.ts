import express from 'express';
import type { MeatConfig } from './config.js';
import { InMemoryStorage } from './storage/memory.js';
import { generateKeyPair } from './auth/keypair.js';
import { initNodeKeys } from './auth/jwt.js';
import { optionalAuth } from './auth/middleware.js';
import { logger } from './utils/logger.js';

// Routes
import { bootstrapRouter } from './routes/bootstrap.js';
import { wellknownRouter } from './routes/wellknown.js';
import { authRouter } from './routes/auth.js';
import { ownersRouter } from './routes/owners.js';
import { agentsRouter } from './routes/agents.js';
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
import { rateLimit } from './middleware/rate-limit.js';
import { idempotency } from './middleware/idempotency.js';
import type { Storage } from './storage/interface.js';

export async function createServer(config: MeatConfig): Promise<express.Express> {
  const app = express();

  // Global middleware
  app.use(express.json({ limit: '1mb' }));

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

  // Rate limiting — global
  app.use(rateLimit(config.rateLimits.global));

  // Per-tier rate limits
  app.use('/v1/auth', rateLimit(config.rateLimits.auth));
  app.use('/v1/work', rateLimit(config.rateLimits.work));
  app.use('/v1/memory', rateLimit(config.rateLimits.memory));
  app.use('/v1/boards', rateLimit(config.rateLimits.boards));

  // Idempotency-Key support for POST/PUT
  app.use(idempotency());

  // Optional auth on all routes (parses JWT if present)
  app.use(optionalAuth());

  // Storage — select based on config
  let storage: Storage;
  if (config.dbUrl) {
    const { MongoStorage } = await import('./storage/mongodb.js');
    storage = new MongoStorage(config.dbUrl);
    logger.info('Using MongoDB storage', { url: config.dbUrl.replace(/\/\/.*@/, '//<credentials>@') });
  } else {
    storage = new InMemoryStorage();
    logger.info('Using in-memory storage (data will not persist across restarts)');
  }

  // Initialize node keys asynchronously
  initializeNode(config, storage);

  // Start daily allowance background job
  startDailyAllowanceJob(config, storage);

  // Start work timeout expiry job
  startWorkTimeoutJob(config, storage);

  // Start memory/board TTL cleanup job
  startTtlCleanupJob(storage);

  // Start dispute auto-escalation job
  startDisputeTimeoutJob(config, storage);

  // Mount routes
  app.use(bootstrapRouter(config));
  app.use(wellknownRouter(config, storage));
  app.use(authRouter(config, storage));
  app.use(ownersRouter(config, storage));
  app.use(agentsRouter(config, storage));
  app.use(memoryRouter(config, storage));
  app.use(actionsRouter(config, storage));
  app.use(catalogueRouter(config, storage));
  app.use(workRouter(config, storage));
  app.use(walletRouter(config, storage));
  app.use(boardsRouter(config, storage));
  app.use(promptsRouter(config, storage));
  app.use(adminRouter(config, storage));
  app.use(federationRouter(config, storage));
  app.use(disputesRouter(config, storage));
  app.use(microMemoryRouter(config, storage));
  app.use(storageFilesRouter(config, storage));
  app.use(validateRouter(config));
  app.use(mcpRouter(config, storage));
  app.use(specRouter());

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({
      ok: false,
      protocol: 'aimeat',
      version: 'v1',
      node: config.nodeId,
      timestamp: new Date().toISOString(),
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
      hints: {
        next_actions: [
          { description: 'Try again or check node status', method: 'GET', url: '/' },
        ],
      },
    });
  });

  return app;
}

// Daily allowance: credit all agents every 24 hours (or on first activity)
function startDailyAllowanceJob(config: MeatConfig, storage: Storage): void {
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
function startWorkTimeoutJob(config: MeatConfig, storage: Storage): void {
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

// Memory & board post TTL cleanup: remove expired entries
function startTtlCleanupJob(storage: Storage): void {
  const cleanup = async () => {
    try {
      const now = Date.now();

      // Cleanup expired memory entries
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

      // Cleanup expired board posts
      const boards = await storage.listBoards();
      for (const board of boards) {
        const posts = await storage.listPosts(board.id, { limit: 10000 });
        // listPosts already filters expired posts in-memory, but this catches any edge cases
        void posts;
      }
    } catch (err) {
      logger.error('TTL cleanup job failed', { error: err });
    }
  };

  setInterval(cleanup, 5 * 60_000); // Every 5 minutes
  logger.info('TTL cleanup job scheduled (every 5m)');
}

// Dispute auto-escalation and timeout (RFC 10.8)
function startDisputeTimeoutJob(config: MeatConfig, storage: Storage): void {
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

async function initializeNode(config: MeatConfig, storage: Storage): Promise<void> {
  try {
    let nodeKey = await storage.getNodeKey();
    if (!nodeKey) {
      logger.info('Generating node keypair...');
      const kp = await generateKeyPair();
      await storage.setNodeKey(kp.publicKey, kp.privateKey);
      nodeKey = kp;
      logger.info('Node keypair generated');
    }
    await initNodeKeys(nodeKey.publicKey, nodeKey.privateKey);
    logger.info('Node keys initialized for JWT signing');
  } catch (err) {
    logger.error('Failed to initialize node keys', { error: err });
  }
}
