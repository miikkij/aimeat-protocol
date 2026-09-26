/**
 * @file src/mcp/package-install-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_package_install_requests on the node's own MCP surface: list the owner's
 *   package install requests, read one, approve or decline one.
 *
 *   WHY FROM A CHAT. An owner's AI chat is an agent (mcp/oauth.ts mints role agent), so an
 *   owner-in-person door is out of its reach. The owner can still settle a request by talking: an
 *   agent of theirs decides it here, under the rule device authorization already uses for a sibling
 *   agent (services/package-install-request-policy.ts). It may approve only a request it did not
 *   file, and only when it holds every word the install needs; otherwise it is refused and told the
 *   owner can approve on their Notifications page. Declining it may do for any request but its own.
 *
 *   ONE IMPLEMENTATION. The work is services/package-install-requests.ts, the same functions the
 *   /v1/package-install-requests doors call; this file resolves who is asking and renders the answer.
 *   packages:write is its word in TOOL_SCOPES, the one those doors ask.
 * @structure registerPackageInstallRequestTools(mcp, storage, config, getAgentGaii, sessionScopes)
 * @usage registerPackageInstallRequestTools(mcp, storage, config, agentGaii, scopes);  // register-all.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: package installs by agents become requests.
 *   v1.0.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { listRequestsFor, readRequestFor, decideInstallRequest } from '../services/package-install-requests.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { localAccountName } from '../utils/gaii.js';

export function registerPackageInstallRequestTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    sessionScopes: string[] = [],
): void {
    mcp.tool('aimeat_package_install_requests', descriptionFor('aimeat_package_install_requests'), {
        request_id: z.string().optional().describe('One request. Omit to list them all.'),
        decision: z.enum(['approve', 'decline']).optional().describe('Decide the request named by request_id.'),
    }, annotationsFor('aimeat_package_install_requests'), async ({ request_id, decision }) => {
        const gaii = getAgentGaii();
        // Every MCP session is an agent's. The owner it acts for comes from its identity, never input.
        const who = { sub: gaii, owner: localAccountName(gaii), roles: ['agent'], scopes: sessionScopes };
        const deps = { storage, config, scheduler: getActiveScheduler() ?? undefined };

        if (decision !== undefined) {
            if (!request_id) return { ...toolError('INVALID_INPUT', 'Name the request to decide with request_id. List them by calling this tool with no arguments.') };
            const out = await decideInstallRequest(deps, who, request_id, decision);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ decision: out.decision, request: out.request }, null, 2) }] };
        }
        if (request_id) {
            const out = await readRequestFor(deps, who, request_id);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ request: out.request }, null, 2) }] };
        }
        const out = await listRequestsFor(deps, who);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ requests: out.requests, waiting: out.waiting }, null, 2) }] };
    });
}
