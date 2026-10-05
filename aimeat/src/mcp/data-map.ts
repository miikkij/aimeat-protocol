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
 * @structure registerDataMapTools(mcp, storage, config, getAgentGaii, getScopes, caller)
 * @usage
 *   import { registerDataMapTools } from './data-map.js';
 *   registerDataMapTools(mcp, storage, config, () => agentGaii, () => scopes, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.2 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.0.1 — 2026-09-20 — The `data_map` parameter says spec /2 and shows a whole object
 *     (DATA_MAP_PARAM in the catalog). It said /1, which the service refuses.
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
  readProgramMap, stateProgramMap, handsOnKey, type DataMapCaller,
} from '../services/data-map/data-map-access.js';
import type { DataMap } from '../services/data-map/data-map-types.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

export function registerDataMapTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  _getAgentGaii: () => string,
  /** The session's scopes. Unused here: the session caller below carries them. */
  _getScopes: () => string[],
  /** The session's caller (services/caller-context.ts). */
  caller: () => CallerContext,
): void {
  /** Who is asking, resolved once per call from the session caller, in the terms the shared service takes. */
  const mapCaller = (): DataMapCaller => {
    const session = caller();
    return {
      principal: session.principal,
      ownerName: session.owner,
      roles: [...session.roles],
      scopes: [...session.scopes],
    };
  };

  mcp.tool(
    'aimeat_datamap_get',
    descriptionFor('aimeat_datamap_get'),
    zodShapeFor('aimeat_datamap_get'),
    annotationsFor('aimeat_datamap_get'),
    async ({ app }) => {
      const out = await readProgramMap(storage, config, mapCaller(), app, new Date().toISOString());
      if ('refusal' in out) return fail(out.refusal.message);
      return text({
        app: out.app, data_map: out.dataMap, stamp: out.stamp, findings: out.findings,
      });
    },
  );

  mcp.tool(
    'aimeat_datamap_set',
    descriptionFor('aimeat_datamap_set'),
    zodShapeFor('aimeat_datamap_set'),
    annotationsFor('aimeat_datamap_set'),
    async ({ app, data_map }) => {
      const out = await stateProgramMap(storage, config, mapCaller(), app,
        data_map as Partial<DataMap>, new Date().toISOString());
      if ('refusal' in out) return fail(out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, findings: out.findings });
    },
  );

  mcp.tool(
    'aimeat_memory_hands',
    descriptionFor('aimeat_memory_hands'),
    zodShapeFor('aimeat_memory_hands'),
    annotationsFor('aimeat_memory_hands'),
    async ({ key }) => {
      const out = await handsOnKey(storage, config, mapCaller(), key);
      return text({ key: out.key, hands: out.hands, not_covered: out.notCovered });
    },
  );
}
