/**
 * @file src/mcp/home-feed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_home_feed on the node's MCP endpoint: what the person's home lists as having
 *   happened, the same answer GET /v1/home/feed gives the page (routes/home/feed.ts). It does not do
 *   the work: homeFeedAnswer (services/home/feed.ts) and the reader rule (accountEventReader) are what
 *   the route calls, so a task's title and reason reach the same readers here as there. The scope
 *   word, memory:read, is applied where every tool is registered (TOOL_SCOPES, from the catalog entry).
 *
 *   The person's own chat answered "nothing shows on the home page" while the page had rows (c9's
 *   round on crew68, 2.11): the feed had a REST route and no tool, so an AI on MCP could not read it.
 *
 *   aimeat_home_waiting: what waits for the person, every kind in one answer, the same answer
 *   GET /v1/home/waiting gives the Home page (services/home/waiting.ts homeWaitingFor). Its scope
 *   word, memory:read, is applied where every tool is registered; each kind inside is read only when
 *   the session also holds that kind's own word.
 * @structure registerHomeFeedTools(mcp, storage, config, caller)
 * @version-history
 *   v1.1.0 — 2026-11-25 — aimeat_home_waiting.
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { homeFeedAnswer } from '../services/home/feed.js';
import { accountEventReader } from '../services/account/event-task-keep.js';
import { homeWaitingFor } from '../services/home/waiting.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function registerHomeFeedTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  mcp.registerTool('aimeat_home_feed', { description: descriptionFor('aimeat_home_feed'), inputSchema: zodShapeFor('aimeat_home_feed'), annotations: annotationsFor('aimeat_home_feed') },
    async () => {
      const c = caller();
      if (c.visitor) return toolError('FORBIDDEN', 'The home feed is an account of this node; a visitor from another node has none here.');
      const reader = await accountEventReader(c, c.auth, storage, config.nodeId);
      return text(await homeFeedAnswer(storage, config, c.owner, reader));
    });

  mcp.registerTool('aimeat_home_waiting', { description: descriptionFor('aimeat_home_waiting'), inputSchema: zodShapeFor('aimeat_home_waiting'), annotations: annotationsFor('aimeat_home_waiting') },
    async (input: { limit?: number }) => {
      const c = caller();
      if (c.visitor) return toolError('FORBIDDEN', 'What waits is an account of this node; a visitor from another node has none here.');
      return text(await homeWaitingFor({ storage, config }, c, { limit: input?.limit }));
    });
}
