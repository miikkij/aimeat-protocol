/**
 * @file src/mcp/dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dataspace on the node MCP: the negotiations of the owner's data packages in data
 *   spaces, approving or declining one, and which packages agree on their own (plan doc-mvwxcas3dom3,
 *   D8.3). It holds no logic of its own: every action calls the function of services/dataspace/owner.ts
 *   that /v1/dataspace calls, with the session's caller, so party:manage, the checks and the writes are
 *   the ones REST runs.
 * @structure registerDataspaceTool(mcp, config, storage, caller)
 * @usage registerDataspaceTool(mcp, config, storage, caller);   // from registerCoreDataPackageTools
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { scopeDeniedText } from './scope-denied-answer.js';
import {
    approveNegotiation, dataspaceSettings, declineNegotiation, getOwnerNegotiation, listOwnerNegotiations,
    type DataspaceAnswer, type DataspaceOwnerCtx,
} from '../services/dataspace/owner.js';
import { PARTY_MANAGE_SCOPE } from '../services/parties/contract.js';

export function registerDataspaceTool(
    mcp: McpServer, config: AimeatConfig, storage: Storage,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const answer = <T>(out: DataspaceAnswer<T>) => {
        if (out.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(out.data, null, 2) }] };
        if (out.code === 'SCOPE_DENIED') {
            return { content: [{ type: 'text' as const, text: scopeDeniedText('aimeat_dataspace', [PARTY_MANAGE_SCOPE], { baseUrl: config.baseUrl, agentGaii: caller().principal }) }], isError: true as const };
        }
        return toolError(out.code, out.message);
    };

    mcp.registerTool('aimeat_dataspace', {
        description: descriptionFor('aimeat_dataspace'), inputSchema: zodShapeFor('aimeat_dataspace'),
        annotations: annotationsFor('aimeat_dataspace'),
    }, async (args) => {
        const ctx: DataspaceOwnerCtx = { deps: { storage, config }, caller: caller() };
        const a = args as Record<string, unknown>;
        const action = String(a.action ?? '');
        const pid = typeof a.provider_pid === 'string' ? a.provider_pid.trim() : '';
        if (['get', 'approve', 'decline'].includes(action) && !pid) return toolError('INVALID_INPUT', `action "${action}" needs provider_pid, the negotiation.`);
        switch (action) {
            case 'list': return answer(await listOwnerNegotiations(ctx, { ...(typeof a.state === 'string' ? { state: a.state } : {}), waiting: a.waiting === true }));
            case 'get': return answer(await getOwnerNegotiation(ctx, pid));
            case 'approve': return answer(await approveNegotiation(ctx, pid));
            case 'decline': return answer(await declineNegotiation(ctx, pid, typeof a.reason === 'string' ? a.reason : undefined));
            case 'settings': return answer(await dataspaceSettings(ctx, a.package !== undefined ? { package: a.package, auto_agree: a.auto_agree ?? null } : undefined));
            default: return toolError('INVALID_INPUT', 'action is one of list, get, approve, decline, settings.');
        }
    });
}
