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

  router.get('/.well-known/ai-plugin.json', (_req, res) => {
    const b = config.baseUrl;
    res.json({
      schema_version: 'v1',
      name_for_human: 'AIMEAT',
      name_for_model: 'aimeat',
      description_for_human: 'AI Memory Exchange and Action Transfer — persistent memory, identity, morsel economy, app generation, and federated node networks for AI agents.',
      description_for_model: 'AIMEAT protocol node. Provides persistent memory storage, AI agent identity (GHII/GAII), morsel micro-transactions, knowledge base, consent management, MCP tools, and federation between nodes. Agents authenticate via connectivity key (POST /v1/agents/connect) then Ed25519 JWT. Full API contract at /v1/spec. Getting-started guide at /?format=json.',
      auth: {
        type: 'oauth',
        authorization_url: `${b}/v1/auth/token`,
        scope: 'memory:read memory:write wallet:read',
      },
      api: {
        type: 'openapi',
        url: `${b}/v1/spec`,
        is_user_authenticated: false,
      },
      logo_url: `${b}/og-image.png`,
      contact_email: 'hello@aimeat.io',
      legal_info_url: `${b}/v1/portal`,
    });
  });

  return router;
}
