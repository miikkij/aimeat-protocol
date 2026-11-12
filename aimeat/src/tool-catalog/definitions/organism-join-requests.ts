/**
 * @file src/tool-catalog/definitions/organism-join-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_access_request, aimeat_organism_join_requests and
 *   aimeat_organism_join_request_review: asking for access to an app or a page opened to one
 *   organism's members, and reading and deciding an organism's join requests, for an AI. On all three
 *   surfaces: the node's MCP endpoint (src/mcp/organism-join-requests.ts), the connector MCP and the
 *   CLI dispatch (src/tool-dispatch/tool-call-defs-organism.ts), the last two over the REST routes.
 *   One implementation: services/organism-join-requests/requests.ts.
 * @structure organismJoinRequestTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial: a join request could be decided on the page and over REST only,
 *     and a person an app refused had no way to ask on the node at all.
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const organismJoinRequestTools = [
    {
        name: 'aimeat_access_request',
        description: 'Ask for access to an app, a welcome page or a company front page that refuses your owner because it is opened only to the members of one shared place (an organism). Name it with `kind` and `ref`. The node files the request with the people who decide who is a member there; they approve or decline it from their notifications, and your owner is told the answer. You are not told which organism it is. With `check: true` nothing is filed: the answer says whether a request can be made (`requestable`) and whether one already waits (`state`: open, none, pending, declined, invited). Refusals: ALREADY_OPEN (it opens already), NOT_REQUESTABLE or REQUESTS_OFF (nothing can be asked here: tell the person to ask the owner directly), ALREADY_PENDING, ASKED_RECENTLY (declined; `ask_again_at` says when a new request is taken).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Ask for Access', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'social:write',
        surfaces: ['agent', 'service'],
        input: {
            kind: { type: 'string', required: true, enum: ['app', 'portfolio', 'company'], description: 'What it is: app (a published app), portfolio (a welcome page) or company (a company front page).' },
            ref: { type: 'string', required: true, description: 'Which one. For an app: <owner>/<filename> (e.g. "alice/notes.html"). For a portfolio: the account name whose welcome page it is. For a company: the company id.' },
            message: { type: 'string', required: false, description: 'A short note to the people who decide: who you are and why you need it. At most 1000 characters.' },
            check: { type: 'boolean', required: false, description: 'true: file nothing, answer only whether a request can be made and what was already asked.' },
        },
    },
    {
        name: 'aimeat_organism_join_requests',
        description: 'List the join requests of an organism your owner owns or administers (owners and admins only). Each has `id`, `ghii` (who asks), `message`, `status`, `createdAt`, and `via` when the person asked from an app or a page that refused them: `via.kind` (app, portfolio, company) and `via.label` (its name). Approving a request makes the person a member of the organism, which opens everything the organism shares with its members, not only that app. Decide one with aimeat_organism_join_request_review.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Join Requests', readOnlyHint: true },
        scope: 'organism:read',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            status: { type: 'string', required: false, enum: ['pending', 'approved', 'rejected'], description: 'Which requests: pending (the default), approved or rejected.' },
        },
    },
    {
        name: 'aimeat_organism_join_request_review',
        description: 'Approve or reject one join request of an organism your owner owns or administers. Approving makes the person an active member of the organism; rejecting tells them it was declined, and they can ask again after 30 days. The person is told the answer either way. Ask your owner before you decide unless they told you whom to let in. Refusals: ALREADY_REVIEWED (someone decided it first), BANNED (the person is blocked: lift the block first), CAPACITY_FULL.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Decide a Join Request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'organism:invite',
        surfaces: ['agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            request_id: { type: 'string', required: true, description: 'The request id, from aimeat_organism_join_requests.' },
            decision: { type: 'string', required: true, enum: ['approved', 'rejected'], description: 'approved or rejected.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
