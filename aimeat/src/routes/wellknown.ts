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
 *   - GET /.well-known/mcp.json: MCP Server Card (SEP-1649) describing the /v1/mcp server + the WebMCP bridge
 *   - GET /.well-known/api-catalog: RFC 9727 linkset (application/linkset+json) pointing at spec/docs/descriptors
 *   - GET /.well-known/ucp: UCP business profile (transports, checkout capability, payment handlers, signing keys)
 *   - discoveryLinkHeaders(): middleware stamping Link rel="api-catalog" + rel="service-desc" on GET/HEAD responses
 *
 * @version-history
 *   v1.7.0 — 2026-07-28 — Discovery documents answer with Access-Control-Allow-Origin: * so a
 *     browser-resident agent can read them; the MCP Server Card carries name/description/version at
 *     the ROOT per server.json (SEP-2127) instead of only inside serverInfo; the UCP profile
 *     declares capabilities as an object keyed by capability name, as the spec requires — the array
 *     it used to send read as "capabilities missing" (agent-readability phase 09)
 *   v1.8.0 — 2026-08-01 — api-catalog links the AI transparency statement (/v1/ai-transparency)
 *   v1.6.0 — 2026-07-14 — api-catalog links the Agent Skills discovery index (/.well-known/agent-skills/index.json)
 *   v1.5.0 — 2026-07-14 — Web Bot Auth key directory at /.well-known/http-message-signatures-directory
 *     (node Ed25519 JWKS, signed response; draft-meunier-http-message-signatures-directory)
 *   v1.4.0 — 2026-07-14 — mcp.json commerce_tools block (inline | pointer via AIMEAT_MCP_CARD_COMMERCE_TOOLS) (TARGET-034 phase D)
 *   v1.3.0 — 2026-07-14 — mcp.json + ucp webmcp bridge references (TARGET-034 phase C)
 *   v1.2.0 — 2026-07-13 — Add UCP business profile (TARGET-033 commerce core)
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
import { listPaymentHandlers } from '../commerce/payment-handlers.js';
import {
  getWebBotAuthState, signatureDirectoryBody, signDirectoryResponse, SIGNATURES_DIRECTORY_MEDIA_TYPE,
} from '../services/web-bot-auth.js';

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

/** The UCP specification version this node's profile and checkout surface are written against. */
const UCP_PROFILE_VERSION = '2026-04-08';

/**
 * Public discovery documents are readable from any origin. They carry no auth, no per-caller data
 * and nothing that is not already public, and a browser-resident agent trying to discover this node
 * gets a CORS failure without the header — it cannot read the card that exists to be read.
 */
const publicDiscovery: RequestHandler = (_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
};

export function wellknownRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  router.use('/.well-known', publicDiscovery);

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
  // Two paths, one card. Readers look for it at either; a card nobody finds is not a card.
  router.get(['/.well-known/mcp.json', '/.well-known/mcp/server-card.json'], async (_req, res) => {
    // commerce_tools (TARGET-034 phase D): the priced app-tool catalog on the card.
    // AIMEAT_MCP_CARD_COMMERCE_TOOLS: 'inline' (default) embeds the entries — richest
    // single-fetch discovery; 'pointer' keeps the card lean and links the catalog endpoint.
    let commerceTools: Record<string, unknown> | undefined;
    if (config.commerceEnabled) {
      const url = `${config.baseUrl}/v1/commerce/tools`;
      if (config.mcpCardCommerceTools === 'pointer') {
        commerceTools = { mode: 'pointer', url, note: 'Priced app-tools sellable through the commerce checkout — fetch the catalog from `url`.' };
      } else {
        const { listPricedAppTools } = await import('../commerce/app-tool-catalog.js');
        const tools = await listPricedAppTools(storage, config, 100);
        commerceTools = {
          mode: 'inline', url, tools, total: tools.length,
          note: 'Priced app-tools sellable through the commerce checkout. Payment IS the invocation: open + complete a checkout session with checkout_item (+ your input); unpaid HTTP invokes answer 402 with x402 accepts. Capped at 100 entries — `url` serves the full catalog.',
        };
      }
    }
    const description = 'AIMEAT protocol node — persistent memory, agent identity (GHII/GAII), organisms and workspaces, knowledge, tasks, skills, and morsel economy for AI agents.';
    res.json({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json',
      // A Server Card follows the server.json shape (SEP-2127): name, description and version at
      // the ROOT. The card previously put the name inside `serverInfo`, which is the shape of the
      // MCP `initialize` RESULT, not of the card — two adjacent schemas, and a reader validating
      // the card against server.json saw a card with no name at all. `serverInfo` stays because it
      // is what the running server reports and some clients read it.
      name: `io.aimeat/${config.nodeId}`,
      description,
      version: getSoftwareVersion(),
      protocolVersion: '2025-06-18',
      serverInfo: {
        // Matches what the MCP server itself reports on initialize (src/mcp/index.ts)
        name: `AIMEAT Node ${config.nodeId}`,
        title: 'AIMEAT',
        version: getSoftwareVersion(),
      },
      transport: {
        type: 'streamable-http',
        endpoint: `${config.baseUrl}/v1/mcp`,
      },
      authentication: {
        required: true,
      },
      // WebMCP bridge (TARGET-034 phase C): pages on this node also expose tools IN-PAGE via
      // document.modelContext (W3C Web Machine Learning CG draft). The portal registers node-level
      // tools at load; published apps register their priced tool manifests through the bridge
      // library. Non-browser agents read the same tools over HTTP from the listing endpoint —
      // priced tools answer 402 + x402 accepts (payment = completing a commerce checkout).
      webmcp: {
        spec: 'https://github.com/webmachinelearning/webmcp',
        library: `${config.baseUrl}/v1/libs/aimeat-webmcp.js`,
        app_listing: `${config.baseUrl}/v1/apps/{owner}/{filename}/webmcp`,
        pages: [`${config.baseUrl}/`],
      },
      ...(commerceTools ? { commerce_tools: commerceTools } : {}),
    });
  });

  // Web Bot Auth key directory (draft-meunier-http-message-signatures-directory): the JWKS a
  // verifier fetches to validate this node's RFC 9421-signed outbound requests. Built from the
  // node's EXISTING Ed25519 key (the one did.json publishes); kid = RFC 7638 thumbprint. The
  // response itself is signed (tag "http-message-signatures-directory") so verifiers can pin it.
  // Served whether or not outbound signing (AIMEAT_WEB_BOT_AUTH_SIGN) is enabled — the directory
  // is harmless alone and lets verification be adopted before signing is switched on.
  router.get('/.well-known/http-message-signatures-directory', async (req, res) => {
    const state = await getWebBotAuthState(storage, config);
    if (!state) {
      res.status(404).json({ error: 'Node keypair not initialized yet' });
      return;
    }
    try {
      const sigHeaders = await signDirectoryResponse(state, req.headers.host ?? new URL(config.baseUrl).host);
      res.set(sigHeaders);
    // eslint-disable-next-line aimeat/no-silent-catch -- directory stays useful unsigned
    } catch { /* directory stays useful unsigned */ }
    res.set('Cache-Control', 'max-age=86400');
    res.type(SIGNATURES_DIRECTORY_MEDIA_TYPE).send(JSON.stringify(signatureDirectoryBody(state)));
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
          'service-meta': [
            { href: `${b}/.well-known/aimeat`, type: 'application/json' },
            { href: `${b}/.well-known/ucp`, type: 'application/json' },
            { href: `${b}/.well-known/agent-skills/index.json`, type: 'application/json' },
            // What this node marks as AI-generated, how, and in which posture (TARGET-058). A
            // discovery document rather than a page: it is the first thing a regulator, a
            // researcher or a buyer's compliance officer needs, and it must be findable without
            // reading HTML.
            { href: `${b}/v1/ai-transparency`, type: 'application/json' },
          ],
        },
        {
          anchor: `${b}/v1/mcp`,
          'service-meta': [{ href: `${b}/.well-known/mcp.json`, type: 'application/json' }],
        },
      ],
    }));
  });

  // UCP business profile (Universal Commerce Protocol, version 2026-04-08) — declares the
  // commerce transports (REST + MCP), the checkout capability, and every payment handler in the
  // commerce registry. The handler list is an honest edition indicator: a Community node
  // advertises only io.aimeat.morsels; an EE node's real-money handlers appear here automatically.
  router.get('/.well-known/ucp', async (_req, res) => {
    const b = config.baseUrl;
    const nodeKey = await storage.getNodeKey();
    const signingKeys = nodeKey
      ? [{ kty: 'OKP', crv: 'Ed25519', x: Buffer.from(nodeKey.publicKey, 'base64').toString('base64url'), use: 'sig' }]
      : [];
    res.json({
      ucp: {
        version: UCP_PROFILE_VERSION,
        // Keyed by VERTICAL, not by transport. This block spent two rounds being corrected on the
        // wrong axis: first the values became arrays, then each entry was told it was missing
        // version/spec/transport — and the reason every message named "rest", "mcp" and "webmcp"
        // is that those were our KEYS. A UCP service declares a vertical's API surface, and the
        // transport is a field inside the entry with an enum value (rest | mcp | a2a | embedded).
        //
        // One entry, because REST at /ucp/v1 is the only place this node actually implements UCP.
        // The MCP server and the in-page WebMCP bridge are real, but they are not UCP bindings;
        // they are declared where they belong, in /.well-known/mcp.json and /.well-known/acp.json.
        // Listing them here would be the same false advertising the ACP document is careful to
        // avoid — a buyer following the declaration to a surface that does not speak the protocol.
        services: {
          shopping: [{
            version: UCP_PROFILE_VERSION,
            spec: `https://ucp.dev/${UCP_PROFILE_VERSION}/specification/overview`,
            transport: 'rest',
            endpoint: `${b}/ucp/v1`,
            schema: `https://ucp.dev/${UCP_PROFILE_VERSION}/services/shopping/rest.openapi.json`,
          }],
        },
        // UCP declares capabilities as an OBJECT keyed by capability name, each key holding an
        // array of declarations. This was an array of {name, ...}, which a validator reads as
        // "capabilities missing" — a wrong type is indistinguishable from an absent field, so the
        // whole commerce surface was invisible to anything that checked. `endpoints` is ours on
        // top of the spec's version/spec/schema; a reader that does not know it ignores it.
        capabilities: config.commerceEnabled ? {
          'dev.ucp.shopping.checkout': [
            {
              version: UCP_PROFILE_VERSION,
              spec: `https://ucp.dev/${UCP_PROFILE_VERSION}/specification/checkout`,
              schema: `https://ucp.dev/${UCP_PROFILE_VERSION}/schemas/shopping/checkout.json`,
              endpoints: {
                create: { method: 'POST', url: `${b}/ucp/v1/checkout-sessions` },
                update: { method: 'PATCH', url: `${b}/ucp/v1/checkout-sessions/{id}` },
                complete: { method: 'POST', url: `${b}/ucp/v1/checkout-sessions/{id}/complete` },
              },
            },
          ],
        } : {},
        payment_handlers: config.commerceEnabled ? listPaymentHandlers().map((h) => ({
          id: h.id, title: h.title, currencies: h.currencies,
        })) : [],
      },
      signing_keys: signingKeys,
    });
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
