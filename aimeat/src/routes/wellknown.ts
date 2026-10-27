/**
 * @file src/routes/wellknown.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the node's discovery documents at /.well-known — the AIMEAT node
 *   descriptor, the MCP Server Card (SEP-1649),
 *   and the RFC 9727 API catalog — plus the RFC 8288 discovery Link-header middleware.
 *
 * @structure
 *   - wellknownRouter(config, storage): mounts the well-known GET endpoints
 *   - GET /.well-known/aimeat: node id/type, protocol edition and profiles (from 4.0.0), payment
 *     bindings, public key, capability set, federation settings, key endpoints
 *   - GET /.well-known/mcp.json: the node's extended MCP card (registry server.json shape) describing the
 *     /v1/mcp server + the WebMCP bridge + the priced tool catalog
 *   - GET /v1/mcp/server-card and /.well-known/mcp/server-card.json: the SEP-2127 Server Card
 *     (mcp/server-card.ts)
 *   - GET /.well-known/api-catalog: RFC 9727 linkset (application/linkset+json) pointing at spec/docs/descriptors
 *   - GET /.well-known/ucp: UCP business profile (transports, checkout capability, payment handlers, signing keys)
 *   - discoveryLinkHeaders(): middleware stamping Link rel="api-catalog" + rel="service-desc" on GET/HEAD responses
 *   - the ARD manifest (/.well-known/ard.json, /.well-known/ai-catalog.json) is routes/ard-manifest.ts, mounted here
 *
 * @version-history
 *   v1.14.0 — 2026-10-27 — The SEP-2127 Server Card at /v1/mcp/server-card (the location the SEP
 *     reserves) and at /.well-known/mcp/server-card.json, which served the extended card until now;
 *     /.well-known/mcp.json keeps the extended card unchanged.
 *   v1.13.0 — 2026-10-26 — Mounts aiCatalogRouter, and the API catalog links the ARD manifest
 *     (wish-ai-catalog-well-known-ai-catalog-json-ard).
 *   v1.12.0 — 2026-10-20 — The MCP server card states 2026-07-28 and lists every revision the node
 *     serves in supportedProtocolVersions (MCP SDK v2 migration step 8, plan item 9).
 *   v1.11.2 — 2026-10-19 — The MCP server card states the revision the node negotiates (MCP_PROTOCOL_VERSION,
 *     src/mcp/protocol-version.ts, held to the SDK), 2025-11-25; it said 2025-06-18
 *     (wish-mcp-2026-07-28-ja-sdk-v2-siirtym-suunnitelma-palvelinkortin-).
 *   v1.11.1 — 2026-10-12 — endpoints.auth stays a string (the owner sign-in, /v1/ghii/login) and the
 *     object with every way in is the new endpoints.sign_in: a change inside v1 is additive.
 *   v1.11.0 — 2026-10-12 — /.well-known/aimeat states protocol_version "2026-11" and the claimed
 *     profiles from node 4.0.0, and the accepted payment bindings and the MCP endpoint in every release
 *     (services/core-discovery.ts, Core 2026-11 DISC-01, DISC-05). endpoints.auth names each current
 *     way to get a token instead of /v1/auth/token alone, whose owner branch 4.0.0 removes.
 *   v1.10.0 — 2026-10-11 — The UCP 2026-04-08 profile lists only the payment handlers that settle
 *     money; the morsel ledger is no longer advertised as a payment handler (ruling D4).
 *   v1.9.0 — 2026-10-08 — GET /.well-known/ucp is the UCP 2026-08-25 business profile
 *     (services/ucp/business-profile.ts): the guest checkout at /ucp/2026-08-25, the order
 *     capability, keys[] and supported_versions. The 2026-04-08 profile moves, unchanged, to
 *     /.well-known/ucp/2026-04-08.
 *   v1.8.1 — 2026-10-07 — The Server Card's commerce_tools note names /v1/commerce/tools?include=own,
 *     which adds the authenticated caller's own owner's unpriced callable tools.
 *   v1.8.0 — 2026-09-18 — GET /.well-known/ai-plugin.json is removed. ChatGPT stopped reading the
 *     plugin format on 2024-04-09; what ChatGPT connects through today is MCP, which the Server
 *     Card here already describes. The manifest had also rotted: it told an agent to authenticate
 *     "via connectivity key (POST /v1/agents/connect)", a flow the bootstrap marks deprecated, and
 *     pointed authorization_url at the Ed25519 signature endpoint. Ruled by the developer in the
 *     instruction review. The MCP card no longer calls morsels an economy.
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
import { MCP_PROTOCOL_VERSION, MCP_SERVED_REVISIONS } from '../mcp/protocol-version.js';
import { moneyPaymentHandlers } from '../commerce/protocol-money.js';
import { businessProfile } from '../services/ucp/business-profile.js';
import { coreDiscoveryFields } from '../services/core-discovery.js';
import {
  getWebBotAuthState, signatureDirectoryBody, signDirectoryResponse, SIGNATURES_DIRECTORY_MEDIA_TYPE,
} from '../services/web-bot-auth.js';
import { aiCatalogRouter } from './ard-manifest.js';
import { mcpServerCard, SERVER_CARD_MEDIA_TYPE } from '../mcp/server-card.js';

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

/**
 * How a client gets a token, one entry per way in. Until 2026-10-12 discovery named only
 * `/v1/auth/token`, whose owner branch is the owner-key sign-in that 4.0.0 removes; the agent's
 * signed renewal on the same route stays, under its own name here.
 */
const SIGN_IN_ENDPOINTS = {
  owner_password: '/v1/ghii/login',
  owner_refresh: '/v1/auth/refresh',
  agent_device_authorization: '/v1/agents/device-authorize',
  agent_device_token: '/v1/agents/device-token',
  agent_token_renewal: '/v1/auth/token',
  mcp_oauth_metadata: '/.well-known/oauth-authorization-server',
} as const;

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
  router.use(aiCatalogRouter(config, storage));

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
      // protocol_version and profiles from 4.0.0, payment_bindings always (services/core-discovery.ts).
      ...coreDiscoveryFields(config),
      public_key: nodeKey?.publicKey ?? null,
      capabilities: capsByType[config.nodeType],
      features_enabled: descriptor.capabilities,
      federation_settings: descriptor.settings,
      endpoints: {
        bootstrap: '/',
        spec: '/v1/spec',
        docs: '/v1/docs',
        mcp: '/v1/mcp',
        // A string, as it has been since v1 began: a change inside v1 is additive. It names the
        // owner sign-in now, not /v1/auth/token; every way in is the object below.
        auth: SIGN_IN_ENDPOINTS.owner_password,
        sign_in: SIGN_IN_ENDPOINTS,
        catalogue: '/v1/catalogue',
      },
    }, [
      { description: 'View the full bootstrap response', method: 'GET', url: '/' },
      { description: 'View the OpenAPI specification', method: 'GET', url: '/v1/spec' },
    ]));
  });

  // The SEP-2127 Server Card: identity, the one remote and the revisions it serves, nothing else.
  // /v1/mcp/server-card is the location the SEP reserves and the one the AI Catalog names; the
  // .well-known path is where the SEP's drafts put it and where scanners still look. Public, so it
  // carries the CORS header itself: /v1/mcp/server-card is outside the /.well-known middleware.
  router.get(['/v1/mcp/server-card', '/.well-known/mcp/server-card.json'], (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    res.type(SERVER_CARD_MEDIA_TYPE).send(JSON.stringify(mcpServerCard(config)));
  });

  // The node's extended MCP card — lets agents discover the node's MCP server, its
  // transport, and that OAuth is required, without probing /v1/mcp blind, plus the WebMCP bridge
  // and the priced tool catalog, which a Server Card has no field for.
  router.get('/.well-known/mcp.json', async (_req, res) => {
    // commerce_tools (TARGET-034 phase D): the priced app-tool catalog on the card.
    // AIMEAT_MCP_CARD_COMMERCE_TOOLS: 'inline' (default) embeds the entries — richest
    // single-fetch discovery; 'pointer' keeps the card lean and links the catalog endpoint.
    let commerceTools: Record<string, unknown> | undefined;
    if (config.commerceEnabled) {
      const url = `${config.baseUrl}/v1/commerce/tools`;
      if (config.mcpCardCommerceTools === 'pointer') {
        commerceTools = { mode: 'pointer', url, note: 'Priced app-tools sellable through the commerce checkout — fetch the catalog from `url`. Authenticated, `url?include=own` adds your own owner\'s unpriced callable tools (price null, own: true).' };
      } else {
        const { listPricedAppTools } = await import('../commerce/app-tool-catalog.js');
        const tools = await listPricedAppTools(storage, config, 100);
        commerceTools = {
          mode: 'inline', url, tools, total: tools.length,
          note: 'Priced app-tools sellable through the commerce checkout. Payment IS the invocation: open + complete a checkout session with checkout_item (+ your input); unpaid HTTP invokes answer 402 with x402 accepts. Capped at 100 entries — `url` serves the full catalog. Authenticated, `url?include=own` adds your own owner\'s unpriced callable tools (price null, own: true), invoked directly on webmcp.invoke.',
        };
      }
    }
    const description = 'AIMEAT protocol node — persistent memory, agent identity (GHII/GAII), organisms and workspaces, knowledge, tasks and skills for AI agents, under permissions the owner grants and can withdraw.';
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
      // The highest revision the MCP endpoint serves, and every revision it serves (src/mcp/protocol-version.ts).
      protocolVersion: MCP_PROTOCOL_VERSION,
      supportedProtocolVersions: MCP_SERVED_REVISIONS,
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
            { href: `${b}/.well-known/ard.json`, type: 'application/json' },
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
  // commerce registry that settles money.
  // The current profile, UCP 2026-08-25: the guest checkout for AI shopping platforms, the order
  // capability, and the keys (services/ucp/business-profile.ts). It names the profile below in
  // `supported_versions`.
  router.get('/.well-known/ucp', async (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(await businessProfile(storage, config));
  });

  // The 2026-04-08 profile, unchanged, for a platform still on that version: the signed-in checkout
  // at /ucp/v1.
  router.get('/.well-known/ucp/2026-04-08', async (_req, res) => {
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
        // Money handlers only: a UCP price is money, and the morsel ledger is not a way to pay one
        // (commerce/protocol-money.ts).
        payment_handlers: config.commerceEnabled ? moneyPaymentHandlers() : [],
      },
      signing_keys: signingKeys,
    });
  });

  return router;
}
