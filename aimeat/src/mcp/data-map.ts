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
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-16 — The data map caller says whether it is a member of this node and carries its session for the operator question, so aimeat_datamap_get applies the app's own visibility as GET /v1/datamap/apps/:owner/:filename does (QA audit list review).
 *   2026-10-11 — aimeat_app_agent_tie and aimeat_app_agent_untie: one row of an app's map that names
 *     an agent, added or removed.
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.2 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.0.1 — 2026-09-20 — The `data_map` parameter says spec /2 and shows a whole object
 *     (DATA_MAP_PARAM in the catalog). It said /1, which the service refuses.
 *   v1.0.0 — 2026-08-25 — TARGET-073.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
  readProgramMap, stateProgramMap, handsOnKey, type DataMapCaller,
} from '../services/data-map/data-map-access.js';
import { tieAgent, untieAgent } from '../services/data-map/data-map-agent-tie.js';
import { toolError } from './tool-error.js';
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
      member: session.kind !== 'anonymous' && !session.visitor,
      auth: session.auth,
    };
  };

  mcp.registerTool(
    'aimeat_datamap_get',
    {
        description: descriptionFor('aimeat_datamap_get'),
        inputSchema: zodShapeFor('aimeat_datamap_get'),
        annotations: annotationsFor('aimeat_datamap_get'),
    },
    async ({ app }) => {
      const out = await readProgramMap(storage, config, mapCaller(), app, new Date().toISOString());
      if ('refusal' in out) return fail(out.refusal.message);
      return text({
        app: out.app, data_map: out.dataMap, stamp: out.stamp, findings: out.findings,
      });
    },
  );

  mcp.registerTool(
    'aimeat_datamap_set',
    {
        description: descriptionFor('aimeat_datamap_set'),
        inputSchema: zodShapeFor('aimeat_datamap_set'),
        annotations: annotationsFor('aimeat_datamap_set'),
    },
    async ({ app, data_map }) => {
      const out = await stateProgramMap(storage, config, mapCaller(), app,
        data_map as Partial<DataMap>, new Date().toISOString());
      if ('refusal' in out) return fail(out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, findings: out.findings });
    },
  );

  // One row of an app's map that names an agent, added or removed. Same implementation as
  // PUT and DELETE /v1/datamap/apps/:owner/:filename/agents/:agent (data-map-agent-tie.ts).
  mcp.registerTool(
    'aimeat_app_agent_tie',
    {
        description: descriptionFor('aimeat_app_agent_tie'),
        inputSchema: zodShapeFor('aimeat_app_agent_tie'),
        annotations: annotationsFor('aimeat_app_agent_tie'),
    },
    async ({ app, target_agent_name, made_for, holds }) => {
      const out = await tieAgent(storage, config, mapCaller(), app, target_agent_name,
        { madeFor: made_for === true, holds }, new Date().toISOString());
      if ('refusal' in out) return toolError(out.refusal.code, out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, findings: out.findings });
    },
  );

  mcp.registerTool(
    'aimeat_app_agent_untie',
    {
        description: descriptionFor('aimeat_app_agent_untie'),
        inputSchema: zodShapeFor('aimeat_app_agent_untie'),
        annotations: annotationsFor('aimeat_app_agent_untie'),
    },
    async ({ app, target_agent_name }) => {
      const out = await untieAgent(storage, config, mapCaller(), app, target_agent_name, new Date().toISOString());
      if ('refusal' in out) return toolError(out.refusal.code, out.refusal.message);
      return text({ app: out.app, data_map: out.dataMap, findings: out.findings });
    },
  );

  mcp.registerTool(
    'aimeat_memory_hands',
    {
        description: descriptionFor('aimeat_memory_hands'),
        inputSchema: zodShapeFor('aimeat_memory_hands'),
        annotations: annotationsFor('aimeat_memory_hands'),
    },
    async ({ key }) => {
      const out = await handsOnKey(storage, config, mapCaller(), key);
      return text({ key: out.key, hands: out.hands, not_covered: out.notCovered });
    },
  );
}
