/**
 * @file agent-conventions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The de-facto conventional paths agent tooling probes at an origin root, each serving
 *   something this node already had somewhere else: `/openapi.json`, `/skill.md`, `/agents.txt`,
 *   `/.well-known/webmcp.json` and `/.well-known/x402.json`.
 *
 *   Measured, not assumed: a scanner was pointed at itself and its probe list read out of the
 *   result — /health, /openapi.json, /skill.md, /llms.txt, /agents.txt. It reads no discovery
 *   document at all. This node's Server Card correctly declares an MCP server at /v1/mcp, its API
 *   catalog correctly links an OpenAPI contract at /v1/spec, and none of that was reached, because
 *   nothing followed the declaration. Being right at our own address and absent from the
 *   conventional one is a distinction only the spec cares about.
 *
 *   Everything here is a rendering of an existing source — the OpenAPI file, the node config, the
 *   x402 network registry — so none of it can drift into describing a node we do not run.
 *
 * @structure
 *   - agentConventionsRouter(config, storage) — mounts the endpoints
 *   - GET /openapi.json             — the contract as JSON (the canonical YAML stays at /v1/spec)
 *   - GET /skill.md                 — SKILL.md with YAML frontmatter: the node as one capability
 *   - GET /agents.txt               — what agents may do here, robots.txt-shaped
 *   - GET /.well-known/webmcp.json  — the node-level in-page tool manifest
 *   - GET /.well-known/x402.json    — machine-payment discovery, derived from the network registry
 * @usage app.use(agentConventionsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-07-29 — Initial (agent-readability phase 14)
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { AimeatConfig } from '../config.js';
import { getX402Network } from '../commerce/x402-facilitator.js';
import { apexOnly } from './agent-docs.js';

/** Locate openapi.yaml the same way specRouter does — the file moves with the deployment layout. */
function findSpecFile(): string | null {
  for (const c of [
    join(process.cwd(), 'openapi.yaml'),
    join(process.cwd(), '..', 'openapi.yaml'),
    join(process.cwd(), 'aimeat', '..', 'openapi.yaml'),
  ]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** The node as a single agent skill: what it is, when to reach for it, how to call it. */
function buildSkillMd(config: AimeatConfig): string {
  const b = config.baseUrl.replace(/\/$/, '');
  return `---
name: aimeat-node
description: Persistent memory, identity and shared workspaces for AI agents. Use when an agent needs state that survives the session, an identity its owner can grant and revoke, or a place to work alongside other agents and people.
version: 1
homepage: ${b}
license: see ${b}/v1/terms
---

# AIMEAT node \`${config.nodeId}\`

> Persistent memory, agent identity (GHII/GAII), shared workspaces, skills, tasks and a usage meter,
> over REST and MCP.

## When to use this

Reach for this node when an agent needs to remember something after the session ends, when a person
must stay in control of what an agent can touch, or when several agents and people work on the same
material. It is the wrong tool for a one-shot script that needs no state.

## Installation

Nothing to install. Two ways in:

- **MCP** — point any MCP-capable client at \`${b}/mcp\` (also \`${b}/v1/mcp\`) and authenticate with
  OAuth 2.1. Server Card: \`${b}/.well-known/mcp.json\`
- **HTTP** — get an identity through the RFC 8628 device flow at \`${b}/auth.md\`, then call the
  endpoints in \`${b}/openapi.json\`

## Usage

\`\`\`bash
curl -X POST ${b}/v1/memory -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"key":"notes.today","value":{"text":"..."},"visibility":"private"}'

curl ${b}/v1/memory/notes.today -H "Authorization: Bearer $TOKEN"
\`\`\`

Every response is enveloped as \`{ success, node_id, data|error, next_actions }\`, and
\`next_actions\` names what to do next, so the API can be followed without a map.

## Configuration

Scopes are chosen by the owner when they approve an agent. A call outside the approved set answers
403 naming the scope, never an empty result.

## Reference

- Full manual: ${b}/llms-full.txt · Index: ${b}/llms.txt
- Orientation: ${b}/AGENTS.md · Vocabulary: ${b}/v1/glossary.md
- Site map: ${b}/sitemap.md · Contract: ${b}/openapi.json
- Skills published here: ${b}/.well-known/agent-skills/index.json
`;
}

/** robots.txt for agents: what they may do, and where the machine-readable answers live. */
function buildAgentsTxt(config: AimeatConfig): string {
  const b = config.baseUrl.replace(/\/$/, '');
  return `# agents.txt — what an AI agent may do on this node
# Node: ${config.nodeId}

User-agent: *
Allow: /

# Read freely. Anything public here is public on purpose.
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /sitemap.md
Allow: /AGENTS.md
Allow: /v1/glossary.md
Allow: /openapi.json

# Writing requires an identity. Agents are never created implicitly: the owner approves each one
# and chooses its scopes (RFC 8628 device authorization).
Identity: ${b}/auth.md
Scopes: memory:read, memory:write, wallet:read, task:write and others, granted per agent

# Machine-readable surfaces
Manual: ${b}/llms-full.txt
Index: ${b}/llms.txt
Skill: ${b}/skill.md
OpenAPI: ${b}/openapi.json
MCP: ${b}/mcp
Payments: ${b}/.well-known/x402.json
Contact: ${config.operator.email || `${b}/v1/portal`}

# Rate limits apply per identity, not per address. A limited call answers 429 with a retry hint
# rather than a silent empty result.
`;
}

/**
 * The node-level in-page tool manifest. Published apps declare their own tools through the bridge
 * library on their own origins; this is what the node itself exposes on its pages.
 */
function buildWebmcpManifest(config: AimeatConfig): object {
  const b = config.baseUrl.replace(/\/$/, '');
  return {
    name: `AIMEAT node ${config.nodeId}`,
    description: 'In-page tools a browser-resident agent can call on this node.',
    version: '1',
    library: `${b}/v1/libs/aimeat-webmcp.js`,
    pages: [`${b}/`],
    tools: [
      {
        name: 'node_info',
        description: 'What this node is, which capabilities it has enabled, and where its contract and manual are.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'commerce_feed',
        description: 'Every publicly priced agent offering and app tool on this node, with its price and how to buy it.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ],
    app_tools: {
      note: 'A published app declares its own tools on its own origin; the HTTP listing mirrors them for non-browser agents.',
      listing: `${b}/v1/apps/{owner}/{filename}/webmcp`,
    },
  };
}

/**
 * x402 discovery, derived from the network registry so it can never advertise a chain or an asset
 * this node cannot settle. `network` follows AIMEAT_X402_NETWORK — flipping to mainnet is a config
 * change and this document follows it, with no edit here.
 *
 * There is no node-level `payTo`. Settlement is non-custodial: the buyer pays the SELLER's own
 * address, taken from that seller's payout settings, and AIMEAT never holds funds. A single payTo
 * here would name a wallet that receives nothing.
 */
function buildX402Json(config: AimeatConfig): object {
  const b = config.baseUrl.replace(/\/$/, '');
  const net = getX402Network(config.x402Network);
  const testnet = config.x402Network.includes('sepolia') || config.x402Network.includes('testnet');
  return {
    x402Version: 1,
    enabled: config.x402Enabled,
    // Stated plainly rather than left to be discovered after a transfer. A testnet rail is a real
    // rail with play money, and a buyer deciding whether to use it deserves to know which it is.
    network: config.x402Network,
    testnet,
    ...(testnet ? { notice: 'This node settles on a TEST network. Funds are testnet tokens with no monetary value.' } : {}),
    facilitator: config.x402FacilitatorUrl,
    scheme: 'exact',
    assets: net
      ? Object.entries(net.assets).map(([currency, a]) => ({
        currency, symbol: a.symbol, address: a.address, decimals: a.decimals, network: net.id,
      }))
      : [],
    // Non-custodial: no node wallet, so no node payTo. Per-item terms come with the 402.
    settlement: {
      custodial: false,
      note: 'Payment goes directly from the buyer to the seller\'s own address. This node never holds funds, so there is no node-level payTo. Each 402 response carries the accepts[] for that specific item.',
    },
    discovery: {
      priced_tools: `${b}/v1/commerce/tools`,
      product_feed: `${b}/v1/commerce/feed`,
      checkout: `${b}/acp/v1/checkout_sessions`,
      ucp_profile: `${b}/.well-known/ucp`,
      acp_profile: `${b}/.well-known/acp.json`,
    },
  };
}

export function agentConventionsRouter(config: AimeatConfig): Router {
  const router = Router();

  // The contract as JSON at the conventional path. The YAML at /v1/spec stays canonical — this is
  // a rendering of the same file, parsed at request time so the two cannot describe different APIs.
  router.get('/openapi.json', apexOnly, (_req, res) => {
    const path = findSpecFile();
    if (!path) {
      res.status(404).json({ error: 'OpenAPI specification not found on this deployment' });
      return;
    }
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}/v1/spec>; rel="canonical"; type="application/yaml"`);
    res.json(YAML.parse(readFileSync(path, 'utf-8')));
  });

  router.get('/skill.md', apexOnly, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.type('text/markdown; charset=utf-8').send(buildSkillMd(config));
  });

  router.get('/agents.txt', apexOnly, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.type('text/plain; charset=utf-8').send(buildAgentsTxt(config));
  });

  router.get('/.well-known/webmcp.json', apexOnly, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(buildWebmcpManifest(config));
  });

  router.get('/.well-known/x402.json', apexOnly, (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(buildX402Json(config));
  });

  return router;
}
