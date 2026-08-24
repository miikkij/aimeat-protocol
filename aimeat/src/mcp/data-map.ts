/**
 * @file src/mcp/data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map over MCP: read where a program puts what, state it, and ask how many
 *   hands have been on a key.
 *
 *   ONE CAPABILITY, ONE IMPLEMENTATION. Every decision here lives in services/data-map-access.ts,
 *   which the HTTP route calls too; this file resolves who is asking and turns an answer into text.
 *   It reaches storage nowhere, and the lint rule that refuses `storage.*` in an MCP tool is what
 *   drove that service into existence — writing a capability twice is what produced 315 measured
 *   differences between this surface and REST.
 *
 *   No new permission word: `memory:read` and `memory:write` already govern the record these read
 *   and write.
 * @structure registerDataMapTools(mcp, storage, config, getAgentGaii, getScopes)
 * @usage
 *   import { registerDataMapTools } from './data-map.js';
 *   registerDataMapTools(mcp, storage, config, () => agentGaii, () => scopes);
 * @version-history
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
  readProgramMap, stateProgramMap, handsOnKey, type DataMapCaller,
} from '../services/data-map/data-map-access.js';
import { buildCoverage } from '../services/data-map/coverage.js';
import type { DataMap } from '../services/data-map/data-map-types.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

export function registerDataMapTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  getScopes: () => string[],
): void {
  /** Who is asking, resolved once, in the terms the shared service takes. */
  const caller = (): DataMapCaller => {
    const principal = getAgentGaii();
    return {
      principal,
      ownerName: ownerGhiiOf(principal).split('@')[0],
      roles: ['agent'],
      scopes: getScopes(),
    };
  };

  mcp.tool(
    'aimeat_datamap_get',
    descriptionFor('aimeat_datamap_get'),
    {
      app: z.string().optional()
        .describe('The app, as "owner/filename.html". Leave it out to get this account\'s own coverage instead.'),
    },
    annotationsFor('aimeat_datamap_get'),
    async ({ app }) => {
      const who = caller();
      // Two questions, two answers: one app's map, or the whole account's coverage.
      if (!app) return text(await buildCoverage(storage, config, who.ownerName, new Date().toISOString()));
      const out = await readProgramMap(storage, config, who, app);
      if ('refusal' in out) return fail(out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, stamp: out.stamp });
    },
  );

  mcp.tool(
    'aimeat_datamap_set',
    descriptionFor('aimeat_datamap_set'),
    {
      app: z.string().describe('The app, as "owner/filename.html".'),
      data_map: z.record(z.string(), z.unknown())
        .describe('The whole map document, carrying spec "aimeat.datamap/1". Read the current one first — this replaces it.'),
    },
    annotationsFor('aimeat_datamap_set'),
    async ({ app, data_map }) => {
      const out = await stateProgramMap(storage, config, caller(), app, data_map as Partial<DataMap>);
      if ('refusal' in out) return fail(out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, hints: out.hints });
    },
  );

  mcp.tool(
    'aimeat_memory_hands',
    descriptionFor('aimeat_memory_hands'),
    { key: z.string().describe('The exact memory key to ask about.') },
    annotationsFor('aimeat_memory_hands'),
    async ({ key }) => {
      const out = await handsOnKey(storage, config, caller(), key);
      return text({ key: out.key, hands: out.hands, not_covered: out.notCovered });
    },
  );
}
