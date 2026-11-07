/**
 * @file src/mcp/csm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_csm on the node MCP: the account's data descriptions (CSM) — list, get, versions,
 *   templates, a draft from a sample, create, update, visibility and delete. It holds no logic of its
 *   own: every action calls the function of services/csm-service.ts that the /v1/csm route calls, with
 *   the session's caller, so the owner prefix, the visibility, the version check and the in-use refusal
 *   are the ones REST runs. The fields are checked against the action's own list first
 *   (definitions/csm.ts checkCsmInput), and a write action without its word answers SCOPE_DENIED with
 *   the address where the owner allows it (mcp/scope-denied-answer.ts).
 * @structure registerCsmTool(mcp, config, storage, caller)
 * @usage registerCsmTool(mcp, config, storage, caller);   // from registerAllServerTools
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, draft; Jouni, 2026-11-07).
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
import { checkCsmInput } from '../tool-catalog/definitions/csm.js';
import { requiredScopeForAction } from '../tool-catalog/action-scopes.js';
import {
    csmTemplates, listCsmsFor, getCsmFor, listCsmVersionsFor, getCsmVersionFor,
    createCsmAs, updateCsmAs, setCsmVisibilityAs, deleteCsmAs, draftCsmFromSample, type CsmAnswer,
} from '../services/csm-service.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerCsmTool(
    mcp: McpServer, config: AimeatConfig, storage: Storage,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const deps = { storage, config };
    const answer = <T>(out: CsmAnswer<T>) => out.ok ? text(out.data) : toolError(out.code, out.message);

    mcp.registerTool('aimeat_csm', {
        description: descriptionFor('aimeat_csm'), inputSchema: zodShapeFor('aimeat_csm'),
        annotations: annotationsFor('aimeat_csm'),
    }, async (args) => {
        const a = args as Record<string, unknown>;
        const checked = checkCsmInput(a);
        if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
        const action = checked.action;
        const who = caller();
        const word = requiredScopeForAction('aimeat_csm', action);
        if (word && !who.has(word)) {
            return { content: [{ type: 'text' as const, text: scopeDeniedText('aimeat_csm', [word], { baseUrl: config.baseUrl, agentGaii: who.principal }) }], isError: true as const };
        }
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        switch (action) {
            case 'list': return answer(await listCsmsFor(deps, who, typeof a.service_type === 'string' ? { serviceType: a.service_type } : {}));
            case 'get': return answer(await getCsmFor(deps, who, name));
            case 'versions': return typeof a.version === 'number'
                ? answer(await getCsmVersionFor(deps, who, name, a.version))
                : answer(await listCsmVersionsFor(deps, who, name));
            case 'templates': {
                const all = csmTemplates();
                if (typeof a.type === 'string') {
                    const one = all.find(t => t.type === a.type);
                    return one ? text({ type: one.type, name: one.name, yaml: one.yaml })
                        : toolError('NOT_FOUND', `CSM template "${a.type}" not found. Call templates without type to list them.`);
                }
                return text({ templates: all.map(t => ({ type: t.type, name: t.name, description: t.description, schema_mode: t.schemaMode })), total: all.length });
            }
            case 'from_sample': return answer(await draftCsmFromSample(deps, who, { name: a.name, sample: a.sample, service_type: a.service_type, description: a.description }));
            case 'create': return answer(await createCsmAs(deps, who, { yaml: a.yaml, definition: a.definition, visibility: a.visibility, federate: a.federate }));
            case 'update': return answer(await updateCsmAs(deps, who, name, { yaml: a.yaml, definition: a.definition, expected_version: a.expected_version }));
            case 'set_visibility': return answer(await setCsmVisibilityAs(deps, who, name, a.visibility));
            case 'delete': return answer(await deleteCsmAs(deps, who, name));
            default: return toolError('INVALID_INPUT', `action "${action}" is not handled`);
        }
    });
}
