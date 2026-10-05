/**
 * @file schedules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the agent schedule tools — parity with the server
 *   MCP (src/mcp/agent-schedules.ts) so `aimeat connect serve --surface agent` exposes the same
 *   scheduling tools locally. Thin REST wrappers over /v1/schedules; aimeat_schedule_report_internal
 *   has no dedicated REST route (it is a structured memory write), so it writes the
 *   `agents.<name>.scheduler` mirror via /v1/memory.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.4.0 -- 2026-09-29 -- aimeat_schedule_create takes kind 'refinery' (input { prefix }), as the node MCP server does.
 *   v1.3.0 -- 2026-09-27 -- aimeat_schedule_list takes `detail` (GET /v1/schedules?detail=true) and
 *     aimeat_schedule_update takes `prompt` (PATCH /v1/schedules/:id), as the node MCP server does.
 *   v1.2.0 -- 2026-09-05 -- An extension schedule can carry the action's own `input` (and an
 *     `instance_id`), keeping parity with the server MCP surface and with the route, which has
 *     stored both since it was written.
 *   v1.1.0 -- 2026-08-13 -- Add aimeat_schedule_trigger (run one now), keeping parity with the
 *     server MCP surface where it was added for the same reason: a new schedule is unproven until
 *     it has run once.
 *   v1.0.0 -- 2026-06-09 -- Initial: close the connector-surfaces gap for schedule_* (create/list/
 *     update/delete/report_internal).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerSchedulesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, agent } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_schedule_create', descriptionFor('aimeat_schedule_create'), zodShapeFor('aimeat_schedule_create'), annotationsFor('aimeat_schedule_create'), async (a) => {
    return out(await client.post('/v1/schedules', a as Record<string, unknown>));
  });

  mcp.tool('aimeat_schedule_list', descriptionFor('aimeat_schedule_list'), zodShapeFor('aimeat_schedule_list'), annotationsFor('aimeat_schedule_list'), async ({ detail }) => {
    return out(await client.get(detail ? '/v1/schedules?detail=true' : '/v1/schedules'));
  });

  mcp.tool('aimeat_schedule_update', descriptionFor('aimeat_schedule_update'), zodShapeFor('aimeat_schedule_update'), annotationsFor('aimeat_schedule_update'), async ({ schedule_id, ...rest }) => {
    return out(await client.patch(`/v1/schedules/${encodeURIComponent(schedule_id)}`, rest as Record<string, unknown>));
  });

  mcp.tool('aimeat_schedule_delete', descriptionFor('aimeat_schedule_delete'), zodShapeFor('aimeat_schedule_delete'), annotationsFor('aimeat_schedule_delete'), async ({ schedule_id }) => {
    return out(await client.delete(`/v1/schedules/${encodeURIComponent(schedule_id)}`));
  });

  mcp.tool('aimeat_schedule_trigger', descriptionFor('aimeat_schedule_trigger'), zodShapeFor('aimeat_schedule_trigger'), annotationsFor('aimeat_schedule_trigger'), async ({ schedule_id }) => {
    return out(await client.post(`/v1/schedules/${encodeURIComponent(schedule_id)}/trigger`, {}));
  });

  // No dedicated REST route: the internal-scheduler mirror is a structured memory record under
  // `agents.<name>.scheduler` (matches the server MCP tool). Write it via /v1/memory.
  mcp.tool('aimeat_schedule_report_internal', descriptionFor('aimeat_schedule_report_internal'), zodShapeFor('aimeat_schedule_report_internal'), annotationsFor('aimeat_schedule_report_internal'), async ({ entries }) => {
    const key = `agents.${agent}.scheduler`;
    const value = { version: 1, updatedAt: new Date().toISOString(), entries: entries.map(e => ({ id: e.id ?? randomUUID(), ...e })) };
    const resp = await client.post('/v1/memory', { key, value, visibility: 'owner', tags: ['scheduler', 'internal'] });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ reported: true, count: entries.length, key, result: resp.data ?? resp }, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });
}
