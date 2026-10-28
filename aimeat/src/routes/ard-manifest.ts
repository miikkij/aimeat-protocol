/**
 * @file src/routes/ard-manifest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's Agentic Resource Discovery (ARD) manifest: one document that lists every
 *   agent-facing resource this node publishes, so a crawler or a registry finds them in one fetch
 *   instead of probing a dozen well-known paths. ARD v0.91 (agenticresourcediscovery.org,
 *   github.com/ards-project/ard-spec) names /.well-known/ard.json; its predecessor, the ai-catalog
 *   data model (github.com/Agent-Card/ai-catalog), names /.well-known/ai-catalog.json, and that is
 *   the path isitagentready.com checks. Both paths answer the same document, which validates against
 *   both schemas: ARD reads `entries` and ignores the rest, ai-catalog allows exactly specVersion,
 *   host and entries. Every entry points at a document another route already serves, so nothing is
 *   described twice: the MCP server card, the OpenAPI contract, the A2A card of each agent whose
 *   owner published an offering, and each public node skill.
 * @structure
 *   - GET /.well-known/ard.json, /.well-known/ai-catalog.json — the manifest (apex only, CORS *)
 *   - buildAiCatalog(config, storage) — the manifest, exported for the unit test
 *   - urnFor() — urn:air:<host>:<namespace>:<name> with each segment held to the spec's pattern
 * @usage
 *   import { aiCatalogRouter } from './ard-manifest.js';
 *   router.use(aiCatalogRouter(config, storage));  // inside wellknownRouter (routes/wellknown.ts)
 * @version-history
 *   v1.0.1 — 2026-10-27 — The MCP entry names the SEP-2127 card at /v1/mcp/server-card.
 *   v1.0.0 — 2026-10-26 — Initial (wish-ai-catalog-well-known-ai-catalog-json-ard).
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { apexOnly } from './agent-docs.js';
import { agentSkillsIndex } from './agent-skills-discovery.js';
import { publishedAgentOfferings } from '../services/a2a-offering.js';
import { getSoftwareVersion } from '../utils/version.js';
import { logger } from '../utils/logger.js';

/** The ai-catalog data model version. The schema's enum has one value; ARD ignores the field. */
const AI_CATALOG_SPEC_VERSION = '1.0';

/** Media types from ARD §3.3. OpenAPI's is the IANA registration for the YAML document. */
const TYPE = {
  mcp: 'application/mcp-server-card+json',
  a2a: 'application/a2a-agent-card+json',
  skill: 'application/agent-skills+md',
  openapi: 'application/vnd.oai.openapi',
} as const;

export interface AiCatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description?: string;
  tags?: string[];
  representativeQueries?: string[];
  version?: string;
}

export interface AiCatalog {
  specVersion: string;
  host: { displayName: string; identifier: string; documentationUrl: string };
  entries: AiCatalogEntry[];
}

/** One URN segment: the spec's pattern allows [a-zA-Z0-9._-]; anything else becomes a hyphen. */
function segment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/** urn:air:<publisher>:<namespace...>:<name>. The publisher is the node's host name (an FQDN in production). */
export function urnFor(host: string, ...parts: string[]): string {
  const publisher = host.replace(/[^a-zA-Z0-9.-]+/g, '-');
  return ['urn', 'air', publisher, ...parts.map(segment)].join(':');
}

/** 2 to 5 queries per entry, the range ARD's conformance tester accepts (§D.2). */
function queries(...q: string[]): string[] {
  return [...new Set(q.map(s => s.trim()).filter(Boolean))].slice(0, 5);
}

export async function buildAiCatalog(config: AimeatConfig, storage: Storage): Promise<AiCatalog> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const host = new URL(base).hostname;
  const version = getSoftwareVersion();
  const entries: AiCatalogEntry[] = [
    {
      identifier: urnFor(host, 'mcp', 'node'),
      displayName: `AIMEAT MCP server (${config.nodeId})`,
      type: TYPE.mcp,
      // The SEP-2127 card, which is what this type names. /.well-known/mcp.json is the node's
      // extended card in the registry server.json shape, and a reader validating it as a Server
      // Card found the wrong document (AGENTSCAN 1.1.0, 2026-10-27).
      url: `${base}/v1/mcp/server-card`,
      description: 'The node\'s MCP server: the person\'s own memory, agents, organisms and workspaces, skills, apps and tasks, under permissions the owner grants and can withdraw. OAuth sign-in.',
      tags: ['mcp', 'memory', 'agents', 'workspaces', 'skills'],
      representativeQueries: queries(
        'remember this in my own knowledge store',
        'search what I have saved about a topic',
        'share a document with my team workspace',
        'connect my AI to a personal memory server',
      ),
      version,
    },
    {
      identifier: urnFor(host, 'api', 'openapi'),
      displayName: `AIMEAT REST API (${config.nodeId})`,
      type: TYPE.openapi,
      url: `${base}/v1/spec`,
      description: 'The OpenAPI contract of every REST endpoint the node serves; the MCP tools call the same endpoints.',
      tags: ['openapi', 'rest'],
      representativeQueries: queries(
        'the REST API of this AIMEAT node',
        'how to authenticate an agent with device authorization',
      ),
      version,
    },
  ];

  // An agent is listed when its owner published an offering, the same consent the A2A directory at
  // /.well-known/agent-card.json follows (routes/a2a.ts). A failed read leaves the rest of the manifest.
  try {
    for (const { agent, offerings } of await publishedAgentOfferings(storage, config)) {
      const title = offerings[0]?.title;
      entries.push({
        identifier: urnFor(host, 'agent', agent.owner, agent.name),
        displayName: agent.displayName ?? agent.name,
        type: TYPE.a2a,
        url: `${base}/v1/a2a/${encodeURIComponent(agent.owner)}/${encodeURIComponent(agent.name)}/agent-card.json`,
        ...(agent.description ? { description: agent.description.slice(0, 1024) } : {}),
        tags: ['a2a', 'agent'],
        representativeQueries: queries(
          ...(title ? [title] : []),
          `ask ${agent.displayName ?? agent.name} to do a task`,
          `hire an agent on ${config.nodeId}`,
        ),
      });
    }
  } catch (err) {
    logger.warn('ai-catalog: agent offerings could not be read, listing the rest', { error: String(err) });
  }

  // The public node skills, from the Agent Skills discovery index and its cache entry.
  try {
    for (const skill of (await agentSkillsIndex(config, storage)).skills) {
      entries.push({
        identifier: urnFor(host, 'skill', skill.name),
        displayName: skill.name,
        type: TYPE.skill,
        url: skill.url,
        description: skill.description,
        tags: ['skill'],
        representativeQueries: queries(
          `how to use ${skill.name.replace(/-/g, ' ')}`,
          skill.description.split(/(?<=[.!?])\s/)[0]!.slice(0, 200),
        ),
      });
    }
  } catch (err) {
    logger.warn('ai-catalog: the skills index could not be read, listing the rest', { error: String(err) });
  }

  return {
    specVersion: AI_CATALOG_SPEC_VERSION,
    host: {
      displayName: `AIMEAT node ${config.nodeId}`,
      // The node's did:web when one is configured; its origin otherwise, which is just as stable.
      identifier: config.vcIssuerDid || base,
      documentationUrl: `${base}/v1/docs`,
    },
    entries,
  };
}

export function aiCatalogRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const serve: RequestHandler = async (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await buildAiCatalog(config, storage));
  };
  router.get('/.well-known/ard.json', apexOnly, serve);
  router.get('/.well-known/ai-catalog.json', apexOnly, serve);
  return router;
}
