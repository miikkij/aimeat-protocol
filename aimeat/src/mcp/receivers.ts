/**
 * @file src/mcp/receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_receiver and aimeat_admin_receivers on the node MCP. They hold no logic of their
 *   own: every action calls the function of services/receivers/manage.ts that the REST routes
 *   /v1/receivers and /v1/admin/receivers call, with the session's caller, so receivers:read,
 *   receivers:manage, the operator check, the node setting and the target checks are the ones REST runs.
 *   checkReceiverInput (the catalog's one table) runs first, as on the CLI dispatch.
 * @structure registerReceiverTools(mcp, config, storage, caller)
 * @usage registerReceiverTools(mcp, config, storage, caller);   // from registerCoreDataPackageTools
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
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
import { checkReceiverInput, RECEIVER_ACTIONS } from '../tool-catalog/definitions/receivers.js';
import { ReceiverError } from '../services/receivers/store.js';
import {
    listForCaller, getForCaller, deliveriesForCaller, createOrPropose, updateSettings, setPaused, rotateKey,
    removeReceiver, operatorList, operatorSetStopped, operatorDecide,
} from '../services/receivers/manage.js';

const SETTING_FIELDS = ['verbs', 'limits', 'visibility', 'display_name', 'description', 'expires_days', 'csm_version', 'target_max_keys'] as const;
const CREATE_FIELDS = ['name', 'target', 'csm', 'csm_version', 'verbs', 'limits', 'visibility', 'display_name', 'description', 'expires_days'] as const;

export function registerReceiverTools(
    mcp: McpServer, config: AimeatConfig, storage: Storage,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const deps = { storage, config };
    const pick = (a: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(f => a[f] !== undefined).map(f => [f, a[f]]));
    const run = async (tool: string, word: string, fn: () => Promise<Record<string, unknown>>) => {
        try {
            return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(), null, 2) }] };
        } catch (err) {
            if (!(err instanceof ReceiverError)) throw err;
            if (err.code === 'SCOPE_DENIED') {
                return { content: [{ type: 'text' as const, text: scopeDeniedText(tool, [word], { baseUrl: config.baseUrl, agentGaii: caller().principal }) }], isError: true as const };
            }
            return toolError(err.code, err.message);
        }
    };

    mcp.registerTool('aimeat_receiver', {
        description: descriptionFor('aimeat_receiver'), inputSchema: zodShapeFor('aimeat_receiver'),
        annotations: annotationsFor('aimeat_receiver'),
    }, async (args) => {
        const a = Object.fromEntries(Object.entries(args as Record<string, unknown>).filter(([, v]) => v !== undefined));
        const checked = checkReceiverInput(a);
        if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
        const c = caller();
        const name = typeof a.name === 'string' ? a.name : '';
        const word = RECEIVER_ACTIONS[checked.action].scope;
        return run('aimeat_receiver', word, async () => {
            switch (checked.action) {
                case 'list': return listForCaller(deps, c);
                case 'get': return getForCaller(deps, c, name);
                case 'deliveries': return deliveriesForCaller(deps, c, name, { onlyRefused: a.only_refused === true });
                case 'propose': return createOrPropose(deps, c, pick(a, CREATE_FIELDS), { propose: true });
                case 'create': return createOrPropose(deps, c, pick(a, CREATE_FIELDS), { propose: false });
                case 'update': return updateSettings(deps, c, name, pick(a, SETTING_FIELDS));
                case 'pause': return setPaused(deps, c, name, true);
                case 'resume': return setPaused(deps, c, name, false);
                case 'rotate': return rotateKey(deps, c, name, a.overlap_minutes);
                case 'delete': return removeReceiver(deps, c, name);
                default: throw new ReceiverError(400, 'INVALID_INPUT', `Unknown action "${checked.action}".`);
            }
        });
    });

    mcp.registerTool('aimeat_admin_receivers', {
        description: descriptionFor('aimeat_admin_receivers'), inputSchema: zodShapeFor('aimeat_admin_receivers'),
        annotations: annotationsFor('aimeat_admin_receivers'),
    }, async (args) => {
        const a = args as Record<string, unknown>;
        const c = caller();
        const action = typeof a.action === 'string' ? a.action : 'list';
        const owner = typeof a.owner === 'string' ? a.owner.trim() : '';
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        const reason = typeof a.reason === 'string' ? a.reason : undefined;
        if (action !== 'list' && (!owner || !name)) return toolError('INVALID_INPUT', `action "${action}" needs owner and name.`);
        return run('aimeat_admin_receivers', 'operator:admin', async () => {
            switch (action) {
                case 'list': return operatorList(deps, c, owner ? { owner } : {});
                case 'stop': return operatorSetStopped(deps, c, owner, name, true, reason);
                case 'start': return operatorSetStopped(deps, c, owner, name, false);
                case 'decide': {
                    if (a.decision !== 'approve' && a.decision !== 'refuse') throw new ReceiverError(400, 'INVALID_INPUT', 'action "decide" needs decision "approve" or "refuse".');
                    return operatorDecide(deps, c, owner, name, a.decision, reason);
                }
                default: throw new ReceiverError(400, 'INVALID_INPUT', 'action is one of list, stop, start, decide.');
            }
        });
    });
}
