/**
 * @file src/mcp/living.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool aimeat_living_author: a living document template designed from a
 *   plain-language need (POST /v1/living/author). It hands the session's caller to the service the
 *   route runs (services/living/author.ts), so the owner pays and the call is planned as this agent's:
 *   the owner's AI policy for the agent, the agent's cap and the owner's allowance apply.
 * @structure registerLivingTools()
 * @usage registerLivingTools(mcp, storage, config, caller) — from mcp/register-all.ts
 * @version-history
 *   v1.0.1 — 2026-11-19 — A database or programming error goes through withCaughtError, so the
 *     answer carries a sentence and a request id and no driver text.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { authorLivingTemplate } from '../services/living/author.js';
import { NotebookAiError } from '../services/notebook/ai.js';

export function registerLivingTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    /** The session's caller: who pays and who asks. */
    caller: () => CallerContext,
): void {
    mcp.registerTool('aimeat_living_author', {
        description: descriptionFor('aimeat_living_author'),
        inputSchema: zodShapeFor('aimeat_living_author'),
        annotations: annotationsFor('aimeat_living_author'),
    }, async ({ need, catalogue }) => {
        try {
            const result = await authorLivingTemplate(storage, config, { caller: caller(), need, catalogue });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
            // The route's two answers: the service's stable code, or AUTHOR_FAILED.
            if (e instanceof NotebookAiError) return { ...toolError(e.code, e.message) };
            // A database or programming error is a fault, answered with a sentence and a request id;
            // any other error's text was written for the caller (mcp/tool-fault.ts).
            return withCaughtError({ ...toolError('AUTHOR_FAILED', (e as Error).message) }, e);
        }
    });
}
