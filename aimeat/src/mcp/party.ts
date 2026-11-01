/**
 * @file src/mcp/party.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_party on the node MCP: share a data package with an outside party in one call,
 *   and make, read, change, stop, resume and delete parties and their keys (plan doc-mvwxcas3dom3, D2,
 *   D3.4). It holds no logic of its own: every action calls the function of services/parties/ that
 *   the REST routes /v1/parties call, with the session's caller, so party:manage, the checks and the
 *   writes are the ones REST runs. `stop` and `resume` with an `owner` other than the session's own
 *   account are the operator's (services/parties/admin.ts), asked with operator:admin as
 *   POST /v1/admin/parties/{owner}/{name}/stop asks it.
 * @structure registerPartyTool(mcp, config, storage, caller)
 * @usage registerPartyTool(mcp, config, storage, caller);   // from registerCoreDataPackageTools
 * @version-history
 *   v1.1.0 — 2026-11-01 — "share" takes `recipient`: a person on another AIMEAT node (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3.4).
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
    createParty, listParties, getParty, updateParty, stopParty, resumeParty, deleteParty, createKey, deleteKey,
    readsOfParty, shareWithParty, type PartyAnswer, type PartyServiceCtx,
} from '../services/parties/service.js';
import { operatorSetStop } from '../services/parties/admin.js';
import { PARTY_MANAGE_SCOPE } from '../services/parties/contract.js';

const SHARE_FIELDS = ['name', 'recipient', 'package', 'purpose', 'days', 'expires', 'kind', 'display_name', 'contact', 'pinned_version', 'allow_url_key', 'terms_required', 'new_key'] as const;
const PARTY_FIELDS = ['name', 'kind', 'display_name', 'contact'] as const;

export function registerPartyTool(
    mcp: McpServer, config: AimeatConfig, storage: Storage,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const answer = <T>(out: PartyAnswer<T>) => {
        if (out.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(out.data, null, 2) }] };
        if (out.code === 'SCOPE_DENIED') {
            return { content: [{ type: 'text' as const, text: scopeDeniedText('aimeat_party', [PARTY_MANAGE_SCOPE], { baseUrl: config.baseUrl, agentGaii: caller().principal }) }], isError: true as const };
        }
        return toolError(out.code, out.message);
    };
    const pick = (a: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(f => a[f] !== undefined).map(f => [f, a[f]]));

    mcp.registerTool('aimeat_party', {
        description: descriptionFor('aimeat_party'), inputSchema: zodShapeFor('aimeat_party'),
        annotations: annotationsFor('aimeat_party'),
    }, async (args) => {
        const c = caller();
        const ctx: PartyServiceCtx = { deps: { storage, config }, caller: c, door: 'mcp' };
        const a = args as Record<string, unknown>;
        const action = String(a.action ?? '');
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        if (!['list', 'share', 'create'].includes(action) && !name) return toolError('INVALID_INPUT', `action "${action}" needs name, the party.`);
        const owner = typeof a.owner === 'string' ? a.owner.trim() : '';
        if ((action === 'stop' || action === 'resume') && owner && owner !== c.owner) {
            // The operator stops another account's party for abuse (D2.9).
            if (!(await c.operator('operator:admin'))) return toolError('FORBIDDEN', 'Stopping another account\'s party is for the operator of this node, with operator:admin.');
            return answer(await operatorSetStop({ storage, config }, owner, name, action === 'stop', typeof a.reason === 'string' ? a.reason : undefined));
        }
        switch (action) {
            case 'share': return answer(await shareWithParty(ctx, pick(a, SHARE_FIELDS)));
            case 'create': return answer(await createParty(ctx, pick(a, PARTY_FIELDS)));
            case 'list': return answer(await listParties(ctx));
            case 'get': return answer(await getParty(ctx, name));
            case 'update': return answer(await updateParty(ctx, name, pick(a, PARTY_FIELDS)));
            case 'stop': return answer(await stopParty(ctx, name));
            case 'resume': return answer(await resumeParty(ctx, name));
            case 'delete': return answer(await deleteParty(ctx, name));
            case 'key_create': return answer(await createKey(ctx, name));
            case 'key_delete': {
                const keyId = typeof a.key_id === 'string' ? a.key_id : '';
                if (!keyId) return toolError('INVALID_INPUT', 'action "key_delete" needs key_id.');
                return answer(await deleteKey(ctx, name, keyId));
            }
            case 'reads': return answer(await readsOfParty(ctx, name));
            default: return toolError('INVALID_INPUT', 'action is one of share, create, list, get, update, stop, resume, delete, key_create, key_delete, reads.');
        }
    });
}
