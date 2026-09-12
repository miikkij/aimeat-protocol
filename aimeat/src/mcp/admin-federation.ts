/**
 * @file src/mcp/admin-federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Federation page over MCP: where this node stands with its peers, what
 *   is waiting on a person, who may sign in here, what this node gives the federation, and how old
 *   the federation book is.
 *
 *   NOTHING COULD READ THIS BEFORE. The federation surface has doors for peers, settlements and
 *   genesis peering, and no tool at all for the operator's own view of it — so an operator asking
 *   their AI "is our federation healthy, does anything need me" got nothing, and the answer was on
 *   a screen. It calls services/federation-overview.ts, the one implementation
 *   GET /v1/admin/federation/overview calls.
 *
 *   THE PEERS MAP IS PASSED IN, not read from storage. It is the live map the federation routes and
 *   the heartbeat job share, and a second copy read off storage would answer about peers as they
 *   were written rather than as they are — last seen, degraded, recovered.
 * @structure registerAdminFederationTools(mcp, storage, config, peers, getAgentGaii) — one read.
 * @usage registerAdminFederationTools(mcp, storage, config, peers, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Federation page's rebuild.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildFederationOverview } from '../services/federation-overview.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminFederationTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  peers: Map<string, PeerInfo>,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();

  mcp.tool('aimeat_admin_federation', descriptionFor('aimeat_admin_federation'),
    {},
    annotationsFor('aimeat_admin_federation'),
    async () => {
      if (!(await resolveOperatorName(storage, agentGaii))) return refuse('Operator role required');
      return text(await buildFederationOverview(config, storage, peers));
    });
}
