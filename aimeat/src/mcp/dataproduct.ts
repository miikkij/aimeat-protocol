/**
 * @file src/mcp/dataproduct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dataproduct on the node MCP: define, get, list, preview, run and delete a data
 *   product (plan doc-mvwxcas3dom3, D9). It holds no logic of its own: every action calls the function
 *   of services/dataproduct/service.ts that the REST route /v1/dataproducts calls, with the session's
 *   caller, so the words, the source checks and the publish are the ones REST runs.
 *
 *   A refusal for a missing word names the word and where the owner grants it, as the session gate's
 *   own answer does (mcp/scope-denied-answer.ts), because define, run and delete ask more than the
 *   tool's catalog scope (storage:read).
 * @structure registerDataProductTool(mcp, config, storage, caller)
 * @usage registerDataProductTool(mcp, config, storage, caller);   // from registerCoreDataPackageTools
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
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
    defineProduct, getProduct, listProducts, deleteProduct, previewProductAnswer, runStored,
    type DataProductAnswer, type DataProductCtx,
} from '../services/dataproduct/service.js';

const DEFINITION_FIELDS = ['title', 'description', 'keywords', 'license', 'sources', 'combine', 'columns', 'filter', 'schedule', 'visibility', 'confirm_personal_public'] as const;

export function registerDataProductTool(
    mcp: McpServer, config: AimeatConfig, storage: Storage,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const answer = <T>(out: DataProductAnswer<T>) => {
        if (out.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(out.data, null, 2) }] };
        if (out.code === 'SCOPE_DENIED' && !out.source) {
            const words = [...out.message.matchAll(/"([a-z]+:[a-z-]+)"/g)].map(m => m[1]!);
            if (words.length) return { content: [{ type: 'text' as const, text: scopeDeniedText('aimeat_dataproduct', words, { baseUrl: config.baseUrl, agentGaii: caller().principal }) }], isError: true as const };
        }
        return toolError(out.code, out.message);
    };

    mcp.registerTool('aimeat_dataproduct', {
        description: descriptionFor('aimeat_dataproduct'), inputSchema: zodShapeFor('aimeat_dataproduct'),
        annotations: annotationsFor('aimeat_dataproduct'),
    }, async (args) => {
        const ctx: DataProductCtx = { deps: { storage, config }, caller: caller() };
        const a = args as Record<string, unknown>;
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        const action = String(a.action ?? '');
        if (action !== 'list' && !name) return toolError('INVALID_INPUT', `action "${action}" needs name, the product (and package) name.`);
        const body = Object.fromEntries(DEFINITION_FIELDS.filter(f => a[f] !== undefined).map(f => [f, a[f]]));
        switch (action) {
            case 'define': return answer(await defineProduct(ctx, name, body));
            case 'get': return answer(await getProduct(ctx, name));
            case 'list': return answer(await listProducts(ctx));
            case 'preview': return answer(await previewProductAnswer(ctx, name, Array.isArray(body.sources) ? body : undefined));
            case 'run': return answer(await runStored(ctx, name));
            case 'delete': return answer(await deleteProduct(ctx, name));
            default: return toolError('INVALID_INPUT', 'action is one of define, get, list, preview, run, delete.');
        }
    });
}
