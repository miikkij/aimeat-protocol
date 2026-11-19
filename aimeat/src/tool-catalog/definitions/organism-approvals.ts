/**
 * @file src/tool-catalog/definitions/organism-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_organism_approval_request and aimeat_organism_approvals: filing an approval
 *   request in an organism and reading its approval inbox, for an AI. On all three surfaces: the
 *   node's MCP endpoint (src/mcp/organism-approvals.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-organism-approvals.ts), the last two over POST and GET
 *   /v1/organisms/:id/approvals. One implementation: services/organism/approvals.ts. A person resolves
 *   a request on the workspace page or over REST, never an agent, so no tool resolves one.
 * @structure organismApprovalTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: an AI could neither file an approval request nor say what waits
 *     (feature audit 2026-11-19, 4.4 item 1).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const organismApprovalTools = [
    {
        name: 'aimeat_organism_approval_request',
        description: 'Ask a person in an organism to approve an action before you take it, under the organism\'s policy. Name the action in `action` (a short verb such as "send-offer" or "delete-records") and what it would do in `arguments` (put the workspace id in `arguments.ws` when it is about one workspace: that workspace\'s own autonomy level then applies). The answer says whether it waits (`gated: true`, status pending) or was approved at once (`gated: false`, with `reason`). A person resolves a waiting request on the workspace page; you never resolve it. Read the answer later with aimeat_organism_approvals. A publish is asked with aimeat_workspace_publish, a member\'s change to a workspace with its own tools, and a team\'s held action by making the call itself; those actions are refused here. Your own `risk` and `approver_role` never loosen the policy. Refusals: NOT_FOUND, ACCESS_DENIED (not an active member), INVALID_INPUT.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask for Approval', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The word POST /v1/organisms/:id/approvals asks.
        scope: 'organism:write',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            action: { type: 'string', required: true, description: 'The action that needs the approval, as a short verb.' },
            arguments: { type: 'object', description: 'What the action would do, for the person who decides. `ws` names the workspace it is about.' },
            prompt: { type: 'string', description: 'The question to the person, in their language.' },
            risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How risky the action is; medium by default. Your own word cannot lower the gate.' },
            approver_role: { type: 'string', description: 'Who should approve (for example "admin"); the organism\'s default unless a flow gate of the manifest names it.' },
            flow_gate_id: { type: 'string', description: 'The manifest flow gate this request belongs to, when there is one.' },
            stage_id: { type: 'string', description: 'The stage of a flow this request belongs to, when there is one.' },
            deadline: { type: 'string', description: 'When the request ends if nobody answers, as an ISO date and time.' },
        },
    },
    {
        name: 'aimeat_organism_approvals',
        description: 'The approval inbox of an organism your owner is an active member of: what waits for a person, and what was decided. Each has `id`, `action`, `arguments`, `actor` (who asked), `status` (pending, approved, rejected, edited), `approverRole`, `createdAt`, and `decidedBy` with `resolutionNote` once decided. `status` filters. A pending request past its deadline is rejected before the list is read. A member\'s suggestion to a workspace is listed only to someone who may read that workspace or who made it. Use it to tell your owner what waits for them, or to see whether your own request was answered. Refusals: NOT_FOUND, ACCESS_DENIED (not an active member).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Approval Inbox', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/organisms/:id/approvals asks.
        scope: 'organism:read',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'edited'], description: 'Which requests. Left out: all.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
