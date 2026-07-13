/**
 * @file src/routes/wellknown.ts
 * @description Serves the node's discovery documents at /.well-known — the AIMEAT node
 *   descriptor, the OpenAI-style ai-plugin.json manifest, the MCP Server Card (SEP-1649),
 *   and the RFC 9727 API catalog — plus the RFC 8288 discovery Link-header middleware.
 *
 * @structure
 *   - wellknownRouter(config, storage): mounts the well-known GET endpoints
 *   - GET /.well-known/aimeat: node id/type, public key, capability set, federation settings, key endpoints
 *   - GET /.well-known/ai-plugin.json: ChatGPT-plugin manifest pointing at /v1/spec
 *   - GET /.well-known/mcp.json: MCP Server Card (SEP-1649) describing the /v1/mcp server
 *   - GET /.well-known/api-catalog: RFC 9727 linkset (application/linkset+json) pointing at spec/docs/descriptors
 *   - discoveryLinkHeaders(): middleware stamping Link rel="api-catalog" + rel="service-desc" on GET/HEAD responses
 *
 * @version-history
 *   v1.1.0 — 2026-07-13 — Add MCP Server Card, RFC 9727 API catalog, and discovery Link headers (agent readiness)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { buildNodeDescriptor } from '../utils/node-descriptor.js';
import { getSoftwareVersion } from '../utils/version.js';

/**
 * RFC 8288 discovery Link headers on every GET/HEAD response, so agents that land on
 * ANY resource (the root redirect included) find the API catalog and the OpenAPI spec
 * without parsing HTML. Mounted before the bootstrap router in routes-loader.
 */
export function discoveryLinkHeaders(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.append('Link', '</.well-known/api-catalog>; rel="api-catalog"');
      res.append('Link', '</v1/spec>; rel="service-desc"; type="application/yaml"');
    }
    next();
  };
}

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

    const descriptor = buildNodeDescriptor(config);

    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      type: config.nodeType,
      protocol: 'aimeat',
      version: 'v1',
      software_version: descriptor.software_version,
      public_key: nodeKey?.publicKey ?? null,
      capabilities: capsByType[config.nodeType],
      features_enabled: descriptor.capabilities,
      federation_settings: descriptor.settings,
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

  // MCP Server Card (SEP-1649) — lets agents discover the node's MCP server, its
  // transport, and that OAuth is required, without probing /v1/mcp blind.
  router.get('/.well-known/mcp.json', (_req, res) => {
    res.json({
      $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
      version: '1.0',
      protocolVersion: '2025-06-18',
      serverInfo: {
        // Matches what the MCP server itself reports on initialize (src/mcp/index.ts)
        name: `AIMEAT Node ${config.nodeId}`,
        title: 'AIMEAT',
        version: getSoftwareVersion(),
      },
      description: 'AIMEAT protocol node — persistent memory, agent identity (GHII/GAII), organisms and workspaces, knowledge, tasks, skills, and morsel economy for AI agents.',
      transport: {
        type: 'streamable-http',
        endpoint: `${config.baseUrl}/v1/mcp`,
      },
      authentication: {
        required: true,
      },
    });
  });

  // API Catalog (RFC 9727) — an RFC 9264 linkset pointing agents at the OpenAPI
  // contract, human docs, the node descriptor, and the MCP server card.
  router.get('/.well-known/api-catalog', (_req, res) => {
    const b = config.baseUrl;
    res.set('Content-Type', 'application/linkset+json').send(JSON.stringify({
      linkset: [
        {
          anchor: `${b}/`,
          'service-desc': [{ href: `${b}/v1/spec`, type: 'application/yaml' }],
          'service-doc': [{ href: `${b}/v1/docs`, type: 'text/html' }],
          'service-meta': [{ href: `${b}/.well-known/aimeat`, type: 'application/json' }],
        },
        {
          anchor: `${b}/v1/mcp`,
          'service-meta': [{ href: `${b}/.well-known/mcp.json`, type: 'application/json' }],
        },
      ],
    }));
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
