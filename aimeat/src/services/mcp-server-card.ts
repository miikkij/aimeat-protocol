/**
 * @file src/services/mcp-server-card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's MCP Server Card in the SEP-2127 shape (MCP Server Cards, the
 *   experimental-ext-server-card schema.ts, schema family v1).
 *
 *   WHY A SECOND CARD. /.well-known/mcp.json is the node's own card from July 2026: the registry
 *   server.json shape with `transport`, `authentication`, `webmcp` and the `commerce_tools`
 *   catalog beside it. Documentation, llms.txt and the app pages link it, and the commerce
 *   catalog has no place in a Server Card, so it stays as it is. A reader that follows the AI
 *   Catalog's `application/mcp-server-card+json` entry expects the SEP card, and validated the old
 *   one as the wrong document (AGENTSCAN 1.1.0, 2026-10-27: "registry server.json shape, not the
 *   SEP-2127 card"). This builds that card: identity, the one remote and the revisions it serves.
 *   A Server Card does not list tools; a client lists them after it connects.
 *
 *   WHERE IT IS SERVED (routes/wellknown.ts): `GET /v1/mcp/server-card`, the location SEP-2127
 *   reserves (`<streamable-http-url>/server-card`), which the AI Catalog entry names, and
 *   `/.well-known/mcp/server-card.json`, the path the SEP's drafts used and scanners still read.
 *
 *   THE LIMITS ARE THE SCHEMA'S. `description` is at most 100 characters, `name` is reverse DNS
 *   with exactly one slash, `version` is not a range. `_meta` keys carry a reverse-DNS prefix.
 * @structure SERVER_CARD_SCHEMA · SERVER_CARD_MEDIA_TYPE · mcpServerCard(config)
 * @usage res.type(SERVER_CARD_MEDIA_TYPE).send(JSON.stringify(mcpServerCard(config)));
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import { getSoftwareVersion } from '../utils/version.js';
import { MCP_SERVED_REVISIONS } from '../mcp/protocol-version.js';

/** The only `$schema` value the v1 card accepts. */
export const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

/** The media type SEP-2127 gives the card; the AI Catalog entry carries the same string as its type. */
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';

/** The software's source, which is public: the same on every node that runs it. */
const REPOSITORY = { url: 'https://github.com/miikkij/aimeat-protocol', source: 'github' } as const;

/** At most 100 characters (the schema's maxLength). The extended card carries the long description. */
const DESCRIPTION = 'Your memory, agents, workspaces, skills, apps and tasks, under permissions you grant and withdraw.';

export interface McpServerCard {
  $schema: typeof SERVER_CARD_SCHEMA;
  name: string;
  version: string;
  description: string;
  title: string;
  websiteUrl: string;
  repository: { url: string; source: string };
  icons: Array<{ src: string; mimeType: string; sizes: string[] }>;
  remotes: Array<{ type: 'streamable-http'; url: string; supportedProtocolVersions: string[] }>;
  _meta: Record<string, unknown>;
}

export function mcpServerCard(config: AimeatConfig): McpServerCard {
  const base = config.baseUrl.replace(/\/+$/, '');
  return {
    $schema: SERVER_CARD_SCHEMA,
    // The same name the extended card and the MCP server's own serverInfo use for this node.
    name: `io.aimeat/${config.nodeId}`,
    version: getSoftwareVersion(),
    description: DESCRIPTION,
    title: 'AIMEAT',
    websiteUrl: `${base}/`,
    repository: { ...REPOSITORY },
    icons: [{ src: `${base}/icons/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }],
    remotes: [{
      type: 'streamable-http',
      url: `${base}/v1/mcp`,
      supportedProtocolVersions: [...MCP_SERVED_REVISIONS],
    }],
    // What the card cannot say in its own fields: the node's extended card (WebMCP bridge, the
    // priced tool catalog) and that the endpoint answers only after OAuth sign-in.
    _meta: {
      'io.aimeat/extended-card': `${base}/.well-known/mcp.json`,
      'io.aimeat/authentication': { required: true, type: 'oauth2' },
    },
  };
}
