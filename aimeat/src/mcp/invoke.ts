/**
 * @file src/mcp/invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat_invoke` on the node's MCP surface: run a capability found with
 *   `aimeat_discover`.
 *
 *   ITS OWN MODULE because it needs the session's raw bearer, which `registerCoreTools` does not
 *   take and should not start taking for one tool. `registerCapabilitiesTools` already gets
 *   `getToken` for the same reason, and this follows it.
 *
 *   The call runs as the CALLER: services/node-invoke.ts dispatches over loopback with this bearer
 *   through the node's real routes, so this tool can do exactly what its caller can do and nothing
 *   more. That is also why there is no scope on it — the scope that matters belongs to whatever it
 *   dispatches to, and is checked there.
 * @structure registerInvokeTool(mcp, config, getToken, getAgentGaii)
 * @usage registerInvokeTool(mcp, config, getToken, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2: discover + invoke).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { invokeNodeCapability } from '../services/node-invoke.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerInvokeTool(
    mcp: McpServer,
    config: AimeatConfig,
    getToken: () => string | undefined,
    getAgentGaii: () => string,
): void {
    mcp.tool(
        'aimeat_invoke',
        descriptionFor('aimeat_invoke'),
        {
            capability: z.string().describe('The capability id, e.g. aimeat_memory_write. Get it from aimeat_discover or GET /v1/capabilities/node.'),
            input: z.record(z.string(), z.unknown()).optional().describe("That capability's own parameters, as an object."),
        },
        annotationsFor('aimeat_invoke'),
        async ({ capability, input }) => {
            const agentGaii = getAgentGaii();
            const out = await invokeNodeCapability(config, {
                id: capability,
                input,
                bearer: getToken(),
                agentName: parseGaiiLoose(agentGaii).agent || agentGaii,
            });
            if (!out.ok) {
                // The refusal text plus its code, because a model reading this has to be able to
                // tell "you named nothing that exists" from "that capability said no".
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ code: out.code, message: out.message, details: out.details }, null, 2) }],
                    isError: true,
                };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ capability: out.capability, result: out.result }, null, 2) }] };
        },
    );
}
