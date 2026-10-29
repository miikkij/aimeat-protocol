/**
 * @file src/tool-catalog/definitions/publish-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_publish_requests: list, read, approve or decline the requests to make something
 *   public that an agent or an app could not make alone (plan doc-mvcn6c7e4e5q, V4.3). On all three
 *   surfaces: the node's MCP endpoint (src/mcp/publish-requests.ts), the connector MCP and the CLI
 *   dispatch (src/tool-dispatch/tool-call-defs-publish.ts), the last two over /v1/publish-requests.
 * @structure publishRequestTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.1.1 — 2026-10-29 — `account` also lets the one who asked read its own request in the account it
 *     asked (secaudit2026oct26 round 8c).
 *   v1.1.0 — 2026-10-25 — The requests that make nothing public, `awaiting_operator` and `account` (secaudit2026oct22, the approval standard).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const publishRequestTools = [
    {
        name: 'aimeat_publish_requests',
        description: 'The requests on your owner\'s account that wait for a one-press answer. Most ask to make something public to anyone (a record, a file, an app, a page) because the one asking lacked the publish:public permission. Others make nothing public and carry `asks` and `why` in plain words: an extension\'s permission to email any address (answered by this node\'s operators), a crew model with its own address set by an app, switching off the question before a secret goes to a new address. With no arguments: the list, newest first, each with its state (awaiting_owner, awaiting_operator, approved, declined, expired, outdated). With request_id: one request. With request_id and decision "approve" or "decline": decide it. You may approve only a request you did not file, and only when you hold the permission it needs (publish:public for publishing); you may decline any request you did not file. A request waiting for the operators is answered only by an operator caller, who names another account with `account`. Otherwise your owner decides on their Notifications page. When a write of yours answered 202 with a request, tell your owner in one sentence what you asked and give them the approve_url from that answer when it has one; the answer comes back to you as a message with the request id.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Lists and reads, and decides: approving makes the target public, declining closes the request.
        // Idempotent: a second decision on a settled request is refused and changes nothing.
        annotations: { title: 'Publish Requests', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word /v1/publish-requests asks on all three routes.
        scope: 'memory:write',
        surfaces: ['agent', 'appdev', 'service'],
        input: {
            request_id: { type: 'string', description: 'One request. Omit to list them all.' },
            decision: { type: 'string', enum: ['approve', 'decline'], description: 'Decide the request named by request_id.' },
            account: { type: 'string', description: 'The account (name or GHII) where the request lives: an operator reads or answers a request waiting for the operators there, and the one who asked reads its own request there. Omit for your own account.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
