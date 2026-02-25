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

export function createServer(config: MeatConfig): express.Express {
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

  // Rate limiting
  app.use(rateLimit({ windowMs: 60_000, max: 200 }));

  // Idempotency-Key support for POST/PUT
  app.use(idempotency());

  // Optional auth on all routes (parses JWT if present)
  app.use(optionalAuth());

  // Storage — in-memory for now (MongoDB support later)
  const storage: Storage = new InMemoryStorage();

  // Initialize node keys asynchronously
  initializeNode(config, storage);

  // Start daily allowance background job
  startDailyAllowanceJob(config, storage);

  // Start work timeout expiry job
  startWorkTimeoutJob(config, storage);

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
