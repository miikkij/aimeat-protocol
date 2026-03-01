import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';

export function wellknownRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/.well-known/aimeat', async (_req, res) => {
    const nodeKey = await storage.getNodeKey();

    const capsByType = {
      full: ['memory', 'actions', 'work', 'wallet', 'boards', 'federation'],
      relay: ['federation', 'routing'],
      mirror: ['memory', 'actions', 'catalogue', 'federation'],
      personal: ['memory', 'actions', 'work', 'wallet'],
    };

    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      type: config.nodeType,
      protocol: 'aimeat',
      version: 'v1',
      public_key: nodeKey?.publicKey ?? null,
      capabilities: capsByType[config.nodeType],
      endpoints: {
        bootstrap: '/',
        spec: '/v1/spec',
        docs: '/v1/docs',
        auth: '/v1/auth/token',
        catalogue: '/v1/catalogue',
      },
    }, [
      { description: 'View the full bootstrap response', method: 'GET', url: '/' },
      { description: 'View the OpenAPI specification', method: 'GET', url: '/v1/spec' },
    ]));
  });

  return router;
}
