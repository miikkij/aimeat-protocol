/**
 * @file apps-fork.ts
 * @description aimeat_app_fork, moved out of mcp/apps.ts by pure extraction when that file passed
 *   the 800-line limit. What is left here is the tool's own business: its two gates, and the answer
 *   it renders. The copy itself is services/app-lifecycle.ts.
 * @structure registerAppForkTool(mcp, storage, config, getAgentGaii, emitResourceListChanged)
 * @usage import { registerAppForkTool } from './apps-fork.js';
 * @version-history
 *   v1.1.0 — 2026-08-11 — August 2026 audit step 8: the write goes through forkApp() in
 *     services/app-lifecycle.ts, the same function POST /v1/apps/:owner/:filename/fork calls. Five
 *     things the HTTP fork does and this one did not now happen on both: the AI disclosure posture is
 *     re-measured against the copied bytes, the source owner's private `specCheck` note is stripped
 *     instead of travelling into someone else's catalogue, the screenshot is copied, a change-log
 *     line is written, and the public feed fires. The caller's bucket is the owner's canonical GHII,
 *     as it is on the HTTP door, rather than a hand-composed `owner@nodeId`.
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/apps.ts (max-file-lines), no behaviour change.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { forkApp, resolveAppOwnerScope } from '../services/app-lifecycle.js';
import { logger } from '../utils/logger.js';

export function registerAppForkTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    // ── Tool 6: aimeat_app_fork ──
    mcp.tool(
        'aimeat_app_fork',
        descriptionFor('aimeat_app_fork'),
        {
            owner: z.string().describe('Owner name of the source app'),
            filename: z.string().describe('Filename of the source app'),
            new_filename: z.string().describe('Filename for the fork in your catalogue. Alphanumeric, dots, hyphens, underscores. Max 100 chars.'),
            version: z.number().optional().describe('Source version to fork (default: latest)'),
        },
        annotationsFor('aimeat_app_fork'),
        async ({ owner, filename, new_filename, version }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            const source = await storage.getAppByOwnerName(owner, filename, version);
            if (!source || source.operatorHidden) {
                return { content: [{ type: 'text' as const, text: `App "${filename}" not found for owner "${owner}"${version ? ` (version ${version})` : ''}` }], isError: true };
            }

            const { ownerName: callerOwner, ownerGhii: callerGhii } = scope;
            const sameOwner = callerOwner === source.ownerName;

            // Gate 1 — derivative permission (agents are never operators here).
            if (!sameOwner && !source.forkable) {
                return { content: [{ type: 'text' as const, text: 'This app is not open for forking by others. Ask the owner to enable forking.' }], isError: true };
            }
            // Gate 2 — a paid source's bytes must not bypass the paywall.
            if (config.marketplaceEnabled && source.manifest.priceMorsels && source.manifest.priceMorsels > 0 && !sameOwner) {
                const hasLicense = await storage.hasValidLicense(agentGaii, source.ownerGaii, filename);
                if (!hasLicense) {
                    return { content: [{ type: 'text' as const, text: `This app costs ${source.manifest.priceMorsels} morsels. Purchase it first before forking.` }], isError: true };
                }
            }

            try {
                // From here it is services/app-lifecycle.ts — the same copy POST .../fork performs,
                // including the target-name check, the per-owner quota, the lineage event, the
                // change log and the feed.
                const out = await forkApp(storage, config, {
                    source,
                    callerOwner,
                    callerGhii,
                    callerGaii: agentGaii,
                    newFilename: new_filename,
                });
                if ('refusal' in out) {
                    return { content: [{ type: 'text' as const, text: out.refusal.message }], isError: true };
                }

                logger.info(`App forked via MCP: ${owner}/${filename} → ${new_filename}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename: out.filename,
                            version_number: out.versionNumber,
                            forked_from: out.forkedFrom,
                            download_url: out.downloadUrl,
                            inline_url: `${out.downloadUrl}?mode=inline`,
                            note: `Forked "${filename}" into your catalogue as "${new_filename}".`,
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to fork app: ${(err as Error).message}` }], isError: true };
            }
        },
    );
}
