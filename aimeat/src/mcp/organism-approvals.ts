/**
 * @file src/mcp/organism-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for an organism's approval requests: aimeat_organism_approval_request
 *   (POST /v1/organisms/:id/approvals) and aimeat_organism_approvals (GET
 *   /v1/organisms/:id/approvals). Each calls the service function its route calls
 *   (services/organism/approvals.ts) with the session's own credential; this file decides nothing
 *   and reads no storage. A person resolves a request, never an agent, so no tool resolves one.
 * @structure registerOrganismApprovalTools()
 * @usage registerOrganismApprovalTools(mcp, storage, config, caller) — from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 1).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { requestApprovalOp, listApprovalsOp } from '../services/organism/approvals.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerOrganismApprovalTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    /** The session's caller: its auth is who asks. */
    caller: () => CallerContext,
): void {
    const deps = { storage, config };

    // ── Tool: aimeat_organism_approval_request ── Mirrors POST /v1/organisms/:id/approvals.
    mcp.registerTool(
        'aimeat_organism_approval_request',
        {
            description: descriptionFor('aimeat_organism_approval_request'),
            inputSchema: zodShapeFor('aimeat_organism_approval_request'),
            annotations: annotationsFor('aimeat_organism_approval_request'),
        },
        async ({ organism_id, action, arguments: args, prompt, risk, approver_role, flow_gate_id, stage_id, deadline }) => {
            const out = await requestApprovalOp(deps, caller().auth, organism_id, {
                action,
                ...(args !== undefined ? { arguments: args } : {}),
                ...(prompt !== undefined ? { prompt } : {}),
                ...(risk !== undefined ? { risk } : {}),
                ...(approver_role !== undefined ? { approverRole: approver_role } : {}),
                ...(flow_gate_id !== undefined ? { flowGateId: flow_gate_id } : {}),
                ...(stage_id !== undefined ? { stageId: stage_id } : {}),
                ...(deadline !== undefined ? { deadline } : {}),
            });
            if (!out.ok) return toolError(out.code, out.message);
            return json({ approval: out.approval, gated: out.gated, reason: out.reason });
        },
    );

    // ── Tool: aimeat_organism_approvals ── Mirrors GET /v1/organisms/:id/approvals.
    mcp.registerTool(
        'aimeat_organism_approvals',
        {
            description: descriptionFor('aimeat_organism_approvals'),
            inputSchema: zodShapeFor('aimeat_organism_approvals'),
            annotations: annotationsFor('aimeat_organism_approvals'),
        },
        async ({ organism_id, status }) => {
            const out = await listApprovalsOp(deps, caller().auth, organism_id, status);
            if (!out.ok) return toolError(out.code, out.message);
            return json({ organism_id, approvals: out.approvals, total: out.total });
        },
    );
}
