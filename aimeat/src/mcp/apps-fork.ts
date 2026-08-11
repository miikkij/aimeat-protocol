/**
 * @file apps-fork.ts
 * @description aimeat_app_fork, moved out of mcp/apps.ts by pure extraction when that file passed
 *   the 800-line limit. The body is verbatim; only the surrounding function is new.
 * @structure registerAppForkTool(mcp, storage, config, getAgentGaii)
 * @usage import { registerAppForkTool } from './apps-fork.js';
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from mcp/apps.ts (max-file-lines), no behaviour change.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
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
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(new_filename)) {
                return { content: [{ type: 'text' as const, text: 'Invalid new_filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.' }], isError: true };
            }

            const source = await storage.getAppByOwnerName(owner, filename, version);
            if (!source || source.operatorHidden) {
                return { content: [{ type: 'text' as const, text: `App "${filename}" not found for owner "${owner}"${version ? ` (version ${version})` : ''}` }], isError: true };
            }

            const callerOwner = parsed.owner;
            const callerGhii = `${callerOwner}@${config.nodeId}`;
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

            const existing = await storage.getLatestVersionNumber(callerGhii, new_filename);
            if (existing > 0) {
                return { content: [{ type: 'text' as const, text: `You already have an app named "${new_filename}". Choose a different new_filename.` }], isError: true };
            }

            // The per-owner app quota, the same rule publish applies on both doors. Forking had it
            // over HTTP and not here, so this tool was the unlimited way past a cap the other two
            // roads enforce.
            if (config.maxAppsPerAgent > 0) {
                const { total } = await storage.listApps({ ownerGaii: callerGhii, limit: 1 });
                if (total >= config.maxAppsPerAgent) {
                    return { content: [{ type: 'text' as const, text: `QUOTA_EXCEEDED: you have reached the maximum of ${config.maxAppsPerAgent} published apps` }], isError: true };
                }
            }

            const now = new Date().toISOString();
            const forkedManifest: AppManifest = {
                ...source.manifest,
                name: `${source.manifest.name || filename.replace(/\.html?$/i, '')} (fork)`,
                authorDisplay: callerOwner,
                forkedFrom: { owner: source.ownerName, filename, version: source.versionNumber, node: config.nodeId },
            };
            delete forkedManifest.priceMorsels;
            delete forkedManifest.licenseType;

            try {
                await storage.createApp({
                    ownerGaii: callerGhii,
                    ownerName: callerOwner,
                    filename: new_filename,
                    versionNumber: 1,
                    manifest: forkedManifest,
                    mimeType: source.mimeType,
                    size: source.size,
                    data: source.data,
                    parked: false,
                    forkable: false,
                    createdAt: now,
                    // A fork copies bytes; it does not generate them. Carry the SOURCE's statement
                    // forward rather than minting a new one — a fresh Mint-3 here would claim the
                    // forker's agent produced content it merely copied, and the hash is the same
                    // bytes either way, so a detection query must lead to the original assertion.
                    ...(source.aiProvenanceId ? { aiProvenanceId: source.aiProvenanceId } : {}),
                });
                await storage.recordAppFork({
                    id: `fork-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
                    sourceOwnerGaii: source.ownerGaii,
                    sourceOwnerName: source.ownerName,
                    sourceFilename: filename,
                    sourceVersion: source.versionNumber,
                    childOwnerGaii: callerGhii,
                    childOwnerName: callerOwner,
                    childFilename: new_filename,
                    forkedByGaii: agentGaii,
                    forkedAt: now,
                });

                const downloadUrl = `/v1/apps/${encodeURIComponent(callerOwner)}/${encodeURIComponent(new_filename)}`;
                logger.info(`App forked via MCP: ${owner}/${filename} → ${new_filename}`, { by: agentGaii });
                // The fork lands in the owner's catalogue, and routes/apps/fork-manage.ts emits for the same act.
                emitChange('apps');
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename: new_filename,
                            version_number: 1,
                            forked_from: { owner: source.ownerName, filename, version: source.versionNumber },
                            download_url: downloadUrl,
                            inline_url: `${downloadUrl}?mode=inline`,
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
