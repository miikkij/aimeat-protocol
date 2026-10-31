/**
 * @file src/mcp/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_overview on the node's MCP endpoint: the account's overview, the same answer
 *   GET /v1/overview gives the Overview page. It does not do the work: readOverview and trimOverview
 *   (services/overview/overview-read.ts) are what the route calls, with the same caller rule
 *   (workspace names need organism:read unless the owner is there in person). The scope word,
 *   agent:read, is applied where every tool is registered (TOOL_SCOPES, from the catalog entry).
 *
 *   WITHOUT `focus` THE TOOL ANSWERS THE BUSIEST TEN OF EACH LANE. An account on aimeat.io has 87
 *   agents and 227 apps, and the whole answer would fill an AI's context with rows nobody asked
 *   about. `limit` raises it, `focus` follows one item's lines.
 * @structure registerOverviewTools(mcp, storage, config, caller)
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readOverview, trimOverview } from '../services/overview/overview-read.js';
import type { OverviewRange } from '../services/overview/overview-types.js';

/** The lane size an AI gets when it names neither `focus` nor `limit`. */
const DEFAULT_LIMIT = 10;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerOverviewTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  mcp.registerTool('aimeat_overview', { description: descriptionFor('aimeat_overview'), inputSchema: zodShapeFor('aimeat_overview'), annotations: annotationsFor('aimeat_overview') },
    async ({ range, focus, limit }) => {
      const c = caller();
      if (c.visitor) return toolError('FORBIDDEN', 'The overview is an account of this node; a visitor from another node has none here.');
      const view = await readOverview({ config, storage }, {
        owner: c.owner, ownerGhii: c.ownerGhii, seeWorkspaces: c.inPerson || c.has('organism:read'),
      }, (range ?? '7d') as OverviewRange);
      const answer = trimOverview(view, { focus: focus || undefined, limit: focus ? undefined : (limit || DEFAULT_LIMIT) });
      if (focus && answer.items.length === 0) return toolError('NOT_FOUND', `No item ${focus} in this account's overview.`);
      return text(answer);
    });
}
