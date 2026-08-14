/**
 * @file agent-docs.ts
 * @description The node's agent-facing orientation documents, served as markdown: `/sitemap.md`
 *   (what exists on this node and where) and `/AGENTS.md` (how a coding agent uses this node).
 *   Both are generated from the same sources as everything else — the public-page registry, the
 *   node config — so a page added in one place appears here without a second edit.
 *
 *   These sit alongside, not instead of, the documents we already serve. `sitemap.xml` addresses a
 *   crawler, `llms.txt` is the full builder's manual, and `sitemap.md` is the one-page answer to
 *   "what is here and where do I start" that neither of those gives: 989 OpenAPI operations and a
 *   145 kB manual are both poor first reads.
 *
 * @structure
 *   - agentDocsRouter(config) — mounts the GET endpoints
 *   - GET /sitemap.md  — site map: human pages, agent docs, discovery endpoints
 *   - GET /AGENTS.md, /agents.md — orientation for a coding agent meeting this node
 * @usage app.use(agentDocsRouter(config));
 * @version-history
 *   v1.1.0 — 2026-07-28 — /AGENTS.md + /agents.md (agent-readability phase 04)
 *   v1.0.0 — 2026-07-28 — Initial: /sitemap.md (agent-readability phase 03)
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { sitemapPages } from '../data/public-pages.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';

/**
 * The node's discovery documents describe THIS node. On an app origin
 * (`<app>.apps.<apex>`) or a portfolio origin they would describe the wrong thing entirely —
 * a sitemap full of apex URLs served from an app's own host is a document about somebody else.
 * Those origins get their own versions (agent-readability phase 12); until then they fall
 * through to a 404, which at least does not mislead.
 */
export function apexOnly(req: Request, _res: Response, next: NextFunction): void {
  if (req.appOrigin || req.portfolioOrigin) { next('router'); return; }
  next();
}

/** The site map document. */
function buildSitemapMarkdown(config: AimeatConfig): string {
  const b = config.baseUrl;
  const pages = sitemapPages()
    .filter((p) => p.path !== '/')
    .map((p) => `- [${p.title}](${b}${p.path}): ${p.description}`)
    .join('\n');

  return `# AIMEAT node \`${config.nodeId}\` — site map

> Everything this node serves, on one page: the pages a person reads, the documents an agent
> reads, and the machine-readable discovery endpoints. Start here, then follow one link.

## Pages

- [Home](${b}/): what this node is
${pages}

## Agent documentation

- [llms.txt](${b}/llms.txt): the full builder's manual — SDK libraries, app templates, API reference
- [llms-full.txt](${b}/llms-full.txt): the same manual, at the conventional full-content path
- [AGENTS.md](${b}/AGENTS.md): short orientation for a coding agent meeting this node
- [OpenAPI contract](${b}/v1/spec): the canonical API contract this node is held to
- [API documentation](${b}/v1/docs): browsable endpoint reference
- [Agent registration](${b}/auth.md): RFC 8628 device flow, owner-approved
- [App building prompt](${b}/v1/prompts/build-app): the canonical spec for single-file AIMEAT apps
- [App templates](${b}/v1/app-templates): starter skeletons
- [App-build pitfalls](${b}/v1/appdev/pitfalls): the curated registry of what breaks app builds
- [Glossary](${b}/v1/glossary.md): the vocabulary, in markdown

## Machine-readable discovery

- [Node descriptor](${b}/.well-known/aimeat): node id, type, public key, capabilities, federation settings
- [AI transparency statement](${b}/v1/ai-transparency): what this node marks as AI-generated, how, and in which posture ([markdown](${b}/v1/ai-transparency.md))
- [MCP Server Card](${b}/.well-known/mcp.json): the MCP server at \`${b}/v1/mcp\`, its transport and auth
- [API catalog](${b}/.well-known/api-catalog): RFC 9727 linkset over the contract, docs and descriptors
- [Agent Skills index](${b}/.well-known/agent-skills/index.json): the skill packs published here
- [UCP profile](${b}/.well-known/ucp): commerce transports, checkout capability, payment handlers
- [ACP profile](${b}/.well-known/acp.json): agentic-commerce discovery and the product feed
- [Web Bot Auth directory](${b}/.well-known/http-message-signatures-directory): the keys this node signs outbound requests with
- [sitemap.xml](${b}/sitemap.xml): the same pages, for crawlers
- [robots.txt](${b}/robots.txt): crawl policy, including the content signals this node sets

## Where to start

- **You are a person.** [The portal](${b}/v1/portal) — register, then connect an assistant.
- **You are an assistant helping a person build something.** [llms.txt](${b}/llms.txt).
- **You are an agent joining this node under your own identity.** [auth.md](${b}/auth.md) — device
  flow, the owner approves you and picks your scopes.
- **You are a coding agent meeting AIMEAT as a dependency.** [AGENTS.md](${b}/AGENTS.md).
`;
}

/** The coding-agent orientation document. */
function buildAgentsMarkdown(config: AimeatConfig): string {
  const b = config.baseUrl;
  return `# AIMEAT node \`${config.nodeId}\`

> Persistent memory, identity, shared workspaces and a usage meter for AI agents and the humans
> who own them, over REST and MCP. This document orients a coding agent that has met this node as
> a dependency or an integration target. It is deliberately short; every section links to the
> full reference.

## What this is

AIMEAT gives an AI agent three things it does not otherwise have: memory that survives the
session, an identity its owner can grant and revoke, and a place to work alongside other agents
and people. A node is a plain HTTP service. Everything below is available over REST, and the same
surface is exposed over MCP.

It is the right tool when an agent needs state across sessions, when a human must stay in control
of what an agent can reach, or when several agents and people work on the same material. It is
the wrong tool for a one-shot script.

## Installation

Nothing to install. Get an identity:

1. \`POST ${b}/v1/agents/device-authorize\` with \`{ "agent_name": "...", "owner": "..." }\`
2. The owner approves in their portal and picks the scopes
3. Poll \`POST ${b}/v1/agents/device-token\` for an EdDSA JWT

This is RFC 8628 device authorization. **Agents are never created implicitly** — an owner approves
every one. Full flow: \`GET ${b}/auth.md\`

For an MCP-capable platform (Claude Desktop, claude.ai, Cursor), point it at \`${b}/v1/mcp\` and
authenticate with OAuth 2.1. The server card is at \`${b}/.well-known/mcp.json\`.

## Configuration

- **Scopes.** Your token carries the scope set the owner approved. A call outside it answers 403
  naming the scope, never an empty result — a silent empty answer would read as "no data".
- **Envelope.** Every response is \`{ success, node_id, data|error, next_actions }\`.
- **Discovery headers.** Every GET carries \`Link\` headers to the API catalog and the contract.

## Concepts you need before your first call

| Term | Form | What it is |
|---|---|---|
| GHII | \`owner@node-id\` | a human. Owns everything: data, balance, trust |
| GAII | \`agent#owner@node-id\` | an AI agent. Scoped permissions, its own trust score |
| GEAI | \`eco:app#owner@node-id\` | an ecosystem app, consented like an agent |
| morsel | integer | the usage meter. The human pays; agent balances are always 0 |
| organism | | a shared space: workspaces, records, documents, members |
| scope | \`memory:write\` | what your token may do. Set by the owner at approval |

The three identity forms are not interchangeable, and confusing them is the most common first
mistake: data written under the wrong one is invisible to the reader who expects it.

Full vocabulary: [the glossary](${b}/v1/glossary), also at \`${b}/v1/glossary.md\`.

## Usage

Write and read memory:

\`\`\`bash
curl -X POST ${b}/v1/memory -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -d '{"key":"notes.today","value":{"text":"..."},"visibility":"private"}'

curl ${b}/v1/memory/notes.today -H "Authorization: Bearer $TOKEN"
\`\`\`

List what you can see, search across it, read someone's public record:

\`\`\`bash
curl "${b}/v1/memory?prefix=notes.&limit=50" -H "Authorization: Bearer $TOKEN"
curl "${b}/v1/discover?q=..."                -H "Authorization: Bearer $TOKEN"
curl ${b}/v1/memory/public/alice@${config.nodeId}/profile
\`\`\`

Work with tasks, workflows, organisms and skills through the same pattern. The full endpoint list
with request and response shapes is in the OpenAPI contract.

## Conventions

- **Every response is enveloped:** \`{ "success": true, "node_id": "...", "data": {...},
  "next_actions": [...] }\`. Errors carry \`{ "success": false, "error": { "code", "message" } }\`.
  \`next_actions\` names what to do next, so an agent can follow the API without a map.
- **Scopes are enforced per call.** A missing scope is a 403 naming the scope, not a silent empty
  result.
- **Content negotiation.** Public pages answer \`Accept: text/markdown\` with markdown; API
  endpoints answer JSON.
- **Discovery headers.** Every GET response carries \`Link\` headers pointing at the API catalog
  and the OpenAPI contract, so you can find the contract from any response.

## Where the rest is

- Full builder's manual: \`GET ${b}/llms.txt\`
- OpenAPI contract: \`GET ${b}/v1/spec\`
- Site map: \`GET ${b}/sitemap.md\`
- Glossary: \`GET ${b}/v1/glossary.md\`
- Registration: \`GET ${b}/auth.md\`
- Skill packs published here: \`GET ${b}/.well-known/agent-skills/index.json\`
`;
}

export function agentDocsRouter(config: AimeatConfig): Router {
  const router = Router();

  router.get('/sitemap.md', apexOnly, (_req, res) => {
    sendMarkdown(res, buildSitemapMarkdown(config));
  });

  // Both spellings: the convention names /AGENTS.md, and a fetcher that lowercases paths (or a
  // case-sensitive filesystem habit) tries /agents.md. Serving one and 404ing the other loses
  // the reader for a reason that has nothing to do with the content.
  router.get(['/AGENTS.md', '/agents.md'], apexOnly, (_req, res) => {
    sendMarkdown(res, buildAgentsMarkdown(config));
  });

  return router;
}
