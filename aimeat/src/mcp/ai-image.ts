/**
 * @file ai-image.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool that makes a picture.
 *
 *   It returns a storage key and a URL, never the image. Bytes in a tool result travel through the
 *   agent's context for no benefit, and goose's code mode drops images from tool results entirely,
 *   so a picture handed back inline would be silently discarded there. A key is text, it points at
 *   something the node already stores, and it is what every other surface here accepts as a way to
 *   name a file.
 * @structure
 *   - registerAiImageTool() — registers aimeat_image_generate on an McpServer instance
 * @usage
 *   import { registerAiImageTool } from './ai-image.js';
 *   registerAiImageTool(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.1.0 — 2026-08-28 — The returned url is the service's fetchUrl (anonymous /v1/pub/ for a
 *     public image), not a hand-built /v1/storage/ path that only the owner could open.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveAppOwnerScope } from '../services/app-lifecycle.js';
import { generateForOwner } from '../services/ai-image.js';
import { AiCompletionError } from '../services/ai-completion.js';

export function registerAiImageTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    mcp.tool(
        'aimeat_image_generate',
        descriptionFor('aimeat_image_generate'),
        {
            prompt: z.string().describe('What the picture should show. Describe it plainly; this is not a chat turn.'),
            size: z.string().optional().describe('Provider-specific size, e.g. "1024x1024". Omit to let the model decide.'),
            storage_key: z.string().optional().describe('Where to store it. Defaults to ai-images/<timestamp>-<random>.<ext>.'),
            public: z.boolean().optional().describe('Make it publicly readable. Needed when a model has to fetch the image back by URL. Default false.'),
            model: z.string().optional().describe('Override the image model. Omit to use the configured one.'),
            app_id: z.string().optional().describe('Attribution for the per-app quota and the spend report.'),
        },
        annotationsFor('aimeat_image_generate'),
        async ({ prompt, size, storage_key, public: isPublic, model, app_id }) => {
            // The OWNER's identity, not the agent's. The API key, the daily budget and the spend
            // record all live under the owner — an agent has no key of its own and its balance is
            // always zero — so an agent making a picture spends the person's allowance, which is
            // what generateForOwner is named after.
            const scope = await resolveAppOwnerScope(storage, config, getAgentGaii());
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }
            const gaii = scope.ownerGhii;
            try {
                const r = await generateForOwner(storage, config, gaii, {
                    prompt, size, storageKey: storage_key,
                    publicVisibility: isPublic === true, model, appId: app_id,
                });
                const base = config.baseUrl.replace(/\/+$/, '');
                // The service builds the URL that actually loads for the visibility's audience —
                // /v1/pub/ when public, /v1/storage/ when private. This tool used to hand back the
                // owner-authenticated form with a note calling it publicly readable, and the first
                // imagery-pipeline demo shipped it into an app where it answered 401 to visitors.
                const path = r.fetchUrl;
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            storage_key: r.storageKey,
                            mime_type: r.mime,
                            size_bytes: r.sizeBytes,
                            model: r.model,
                            visibility: r.visibility,
                            url: `${base}${path}`,
                            cost_usd: r.usage.costUsd,
                            cost_exact: r.usage.costExact,
                            remaining_today_usd: r.budget.remainingUsd,
                            note: r.visibility === 'public'
                                ? 'Stored and publicly readable, so the URL can be handed to a vision model or used in an app.'
                                : 'Stored privately. Pass public: true if a model or a page has to fetch it by URL.',
                        }, null, 2),
                    }],
                };
            } catch (e) {
                if (e instanceof AiCompletionError) {
                    return { content: [{ type: 'text' as const, text: `${e.code}: ${e.message}` }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: `Image generation failed: ${(e as Error).message}` }], isError: true };
            }
        },
    );
}
