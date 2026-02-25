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
import { specRouter } from './routes/spec.js';
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

  // Optional auth on all routes (parses JWT if present)
  app.use(optionalAuth());

  // Storage — in-memory for now (MongoDB support later)
  const storage: Storage = new InMemoryStorage();

  // Initialize node keys asynchronously
  initializeNode(config, storage);

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
