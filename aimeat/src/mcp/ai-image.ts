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
 *   2026-10-08 — The result names the picture's provenance record: provenance_id and record_url.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.4.0 — 2026-09-28 — `role`, the AI role the call runs as, forwarded as on POST /v1/ai/image.
 *   v1.3.0 — 2026-09-28 — `provider` and `fallback`, forwarded as on POST /v1/ai/image (System 2, V3).
 *   v1.2.0 — 2026-09-28 — The asking agent is named to the service, so its own key pays first and its
 *     daily cap applies, as on /v1/ai/complete. The owner still pays and stores.
 *   v1.1.0 — 2026-08-28 — The returned url is the service's fetchUrl (anonymous /v1/pub/ for a
 *     public image), not a hand-built /v1/storage/ path that only the owner could open.
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { resolveAppOwnerScope } from '../services/app-lifecycle.js';
import { generateForOwner } from '../services/ai-image.js';
import { AiCompletionError } from '../services/ai/completion.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { aiCallerOfPrincipal } from '../services/ai/caller-context.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { recordUrlFor } from '../services/ai-provenance-marks.js';

export function registerAiImageTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    mcp.tool(
        'aimeat_image_generate',
        descriptionFor('aimeat_image_generate'),
        zodShapeFor('aimeat_image_generate'),
        annotationsFor('aimeat_image_generate'),
        async ({ prompt, size, storage_key, public: isPublic, model, app_id, provider, fallback, role }) => {
            // The OWNER's identity, not the agent's. The API key, the daily budget and the spend
            // record all live under the owner — an agent has no key of its own and its balance is
            // always zero — so an agent making a picture spends the person's allowance, which is
            // what generateForOwner is named after.
            const scope = await resolveAppOwnerScope(storage, config, getAgentGaii());
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }
            const gaii = scope.ownerGhii;
            // Who asked, for the agent's own key and cap; the owner above still pays and stores.
            const { agent } = aiPayerOf(getAgentGaii());
            try {
                const r = await generateForOwner(storage, config, gaii, {
                    prompt, size, storageKey: storage_key,
                    publicVisibility: isPublic === true, model, appId: app_id,
                    ...(agent ? { agent } : {}), caller: aiCallerOfPrincipal(getAgentGaii()).caller,
                    ...(provider ? { provider } : {}),
                    ...(fallback !== undefined ? { fallback } : {}),
                    ...(role ? { role } : {}),
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
                            // The record minted for the picture's bytes: the stored file names it, and
                            // a public picture's record resolves for anyone at record_url.
                            ...(r.provenance ? { provenance_id: r.provenance.id, record_url: recordUrlFor(config, r.provenance.id) } : {}),
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
