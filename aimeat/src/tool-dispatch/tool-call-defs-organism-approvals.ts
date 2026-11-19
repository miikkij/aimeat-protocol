/**
 * @file src/tool-dispatch/tool-call-defs-organism-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism approval tools for the shell / local-call dispatch and the connector MCP,
 *   over POST and GET /v1/organisms/:id/approvals (routes/organisms/gates.ts). The route decides who
 *   may ask; this file only forwards.
 * @structure organismApprovalCliTools[]
 * @usage import { organismApprovalCliTools } from './tool-call-defs-organism-approvals.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial: aimeat_organism_approval_request and aimeat_organism_approvals.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString, coerceObject, query } from './tool-call-helpers.js';

export const organismApprovalCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/organisms/:id/approvals
        name: 'aimeat_organism_approval_request',
        handler: ({ client }, input) => {
            const body: JsonObject = { action: requiredString(input, 'action') };
            // A shell passes an object as JSON text; coerceObject reads both forms.
            const args = coerceObject(input.arguments);
            if (args && typeof args === 'object' && !Array.isArray(args)) body.arguments = args as JsonObject;
            for (const [from, to] of [['prompt', 'prompt'], ['risk', 'risk'], ['approver_role', 'approverRole'],
                ['flow_gate_id', 'flowGateId'], ['stage_id', 'stageId'], ['deadline', 'deadline']] as const) {
                const v = optionalString(input, from); if (v !== undefined) body[to] = v;
            }
            return client.post(`/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/approvals`, body);
        },
    },
    {
        // → GET /v1/organisms/:id/approvals?status=
        name: 'aimeat_organism_approvals',
        handler: ({ client }, input) => client.get(
            `/v1/organisms/${encodeURIComponent(requiredString(input, 'organism_id'))}/approvals${query({ status: optionalString(input, 'status') })}`,
        ),
    },
];
