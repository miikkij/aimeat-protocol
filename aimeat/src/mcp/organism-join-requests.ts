/**
 * @file src/mcp/organism-join-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for an organism's join requests: asking for access to an app or a page
 *   opened to one organism's members (aimeat_access_request), and reading and deciding an organism's
 *   join requests (aimeat_organism_join_requests, aimeat_organism_join_request_review). Each calls
 *   the service functions the REST routes call (services/organism-join-requests/requests.ts), and an
 *   access request's target is found by the finders its routes use
 *   (services/organism-join-requests/access-targets.ts). This file decides nothing and reads no
 *   storage.
 * @structure registerOrganismJoinRequestTools()
 * @usage registerOrganismJoinRequestTools(mcp, config, storage, getOwnerName, agentGaii, emitResourceUpdated, caller);
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import type { CallerContext } from '../services/caller-context.js';
import {
    requestAccess, accessRequestState, readJoinRequests, decideJoinRequest,
} from '../services/organism-join-requests/requests.js';
import { accessTargetOf } from '../services/organism-join-requests/access-targets.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerOrganismJoinRequestTools(
    mcp: McpServer,
    config: AimeatConfig,
    storage: Storage,
    getOwnerName: () => string,
    agentGaii: string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    /** The session's caller: its auth is who asks, and its principal is who decided. */
    caller: () => CallerContext,
): void {
    const deps = { storage, config };

    // ── Tool: aimeat_access_request ──
    // Mirrors GET and POST …/access-request of the three targets.
    mcp.registerTool(
        'aimeat_access_request',
        {
            description: descriptionFor('aimeat_access_request'),
            inputSchema: zodShapeFor('aimeat_access_request'),
            annotations: annotationsFor('aimeat_access_request'),
        },
        async ({ kind, ref, message, check }) => {
            const auth = caller().auth;
            const target = await accessTargetOf(storage, config, auth, kind, ref);
            if (!target) return toolError('NOT_FOUND', kind === 'app' ? 'No app here.' : 'No page here.');
            if (check) return json(await accessRequestState(deps, auth, target));
            const result = await requestAccess(deps, auth, target, message);
            if (!result.ok) {
                return toolError(result.code, result.askAgainAt ? `${result.message} ask_again_at: ${result.askAgainAt}` : result.message);
            }
            return json({ status: 'pending', asked_at: result.joinRequest.createdAt });
        },
    );

    // ── Tool: aimeat_organism_join_requests ──
    // Mirrors GET /v1/organisms/:id/join-requests.
    mcp.registerTool(
        'aimeat_organism_join_requests',
        {
            description: descriptionFor('aimeat_organism_join_requests'),
            inputSchema: zodShapeFor('aimeat_organism_join_requests'),
            annotations: annotationsFor('aimeat_organism_join_requests'),
        },
        async ({ organism_id, status }) => {
            const result = await readJoinRequests(deps, organism_id, getOwnerName(), status);
            if (!result.ok) return toolError(result.code, result.message);
            return json({ organism_id, join_requests: result.requests, total: result.requests.length });
        },
    );

    // ── Tool: aimeat_organism_join_request_review ──
    // Mirrors POST /v1/organisms/:id/join-requests/:requestId/review.
    mcp.registerTool(
        'aimeat_organism_join_request_review',
        {
            description: descriptionFor('aimeat_organism_join_request_review'),
            inputSchema: zodShapeFor('aimeat_organism_join_request_review'),
            annotations: annotationsFor('aimeat_organism_join_request_review'),
        },
        async ({ organism_id, request_id, decision }) => {
            const result = await decideJoinRequest(deps, organism_id, request_id, decision,
                { owner: getOwnerName(), principal: caller().principal });
            if (!result.ok) return toolError(result.code, result.message);
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return json({ organism_id, request_id, decision: result.decision, member: result.request.ghii });
        },
    );
}
