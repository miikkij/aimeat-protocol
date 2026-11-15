/**
 * @file src/mcp/disputes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_disputes and aimeat_admin_dispute_rule on the node's MCP: the operator's
 *   AI reads the disputes that wait for a ruling and rules one, through the functions the REST routes
 *   GET /v1/admin/disputes, GET /v1/admin/disputes/:id and POST /v1/admin/disputes/:id/rule call
 *   (services/disputes/operator.ts).
 * @structure registerDisputeTools
 * @usage registerDisputeTools(mcp, config, storage, caller) from mcp/core-admin.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { emitChange } from '../services/event-bus.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/operator/principal.js';
import {
  listOperatorDisputes, getOperatorDispute, ruleDispute, DISPUTE_LIST_STATUSES, type DisputeListStatus,
} from '../services/disputes/operator.js';

const OPERATOR_ONLY = OPERATOR_AGENT_REFUSAL;
const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

export function registerDisputeTools(mcp: McpServer, _config: AimeatConfig, storage: Storage, caller: () => CallerContext): void {
  mcp.registerTool('aimeat_admin_disputes', {
    description: descriptionFor('aimeat_admin_disputes'), inputSchema: zodShapeFor('aimeat_admin_disputes'),
    annotations: annotationsFor('aimeat_admin_disputes'),
  }, async (args) => {
    const c = caller();
    if (!(await c.operator('operator:admin'))) return toolError('FORBIDDEN', OPERATOR_ONLY);
    const { id, status } = args as { id?: string; status?: string };
    if (id) {
      const one = await getOperatorDispute(storage, id);
      return one ? text(one) : toolError('NOT_FOUND', `No dispute ${id} on this node.`);
    }
    const reading = (status ?? 'escalated') as DisputeListStatus;
    if (!DISPUTE_LIST_STATUSES.includes(reading)) return toolError('INVALID_INPUT', 'status is "escalated", "open" or "all".');
    return text({ disputes: await listOperatorDisputes(storage, reading) });
  });

  mcp.registerTool('aimeat_admin_dispute_rule', {
    description: descriptionFor('aimeat_admin_dispute_rule'), inputSchema: zodShapeFor('aimeat_admin_dispute_rule'),
    annotations: annotationsFor('aimeat_admin_dispute_rule'),
  }, async (args) => {
    const c = caller();
    if (!(await c.operator('operator:admin'))) return toolError('FORBIDDEN', OPERATOR_ONLY);
    const { id, ruling, to_requester, burned, reason } = args as { id: string; ruling: string; to_requester?: number; burned?: number; reason?: string };
    for (const [name, v] of [['to_requester', to_requester], ['burned', burned]] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 0)) return toolError('INVALID_INPUT', `${name} is a whole number of morsels, 0 or more.`);
    }
    const out = await ruleDispute(storage, c.principal, id, { ruling, distribution: { to_requester: to_requester ?? 0, burned: burned ?? 0 }, reason });
    if (!out.ok) return toolError(out.code, out.message);
    emitChange('disputes');
    return text(out.data);
  });
}
