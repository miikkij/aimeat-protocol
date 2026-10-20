/**
 * @file apps-fork.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_fork, moved out of mcp/apps.ts by pure extraction when that file passed
 *   the 800-line limit. What is left here is the tool's own business: its two gates, and the answer
 *   it renders. The copy itself is services/app-lifecycle.ts.
 * @structure registerAppForkTool(mcp, storage, config, getAgentGaii, emitResourceListChanged, caller)
 * @usage import { registerAppForkTool } from './apps-fork.js';
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-18 — The fork passes the publish gate (services/app-publish-gate.ts): a fork the node's
 *     defaults would make public, by an agent without publish:public, lands unlisted and answers with
 *     `publish_request` (plan doc-mvcn6c7e4e5q, V4).
 *   2026-10-16 — A fork of an older version reads the pacing amount of the latest version (QA audit F10a-01).
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-15 — Gate 2 asks the licence for the version it copies (feature-list audit #110).
 *   v1.2.0 — 2026-10-11 — Gate 2 reads the app's pacing amount (`tollMorsels`; a morsel is pacing, not
 *     a price) and asks the licence of the caller's owner GHII, as POST .../fork does. It asked the
 *     agent's own GAII, which no receipt is keyed on, so an agent could not fork an app its owner took.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
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
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { forkApp, resolveAppOwnerScope } from '../services/app-lifecycle.js';
import { logger } from '../utils/logger.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { appIsPaced, appToll } from '../services/app-pacing.js';
import { currentAppRow } from '../services/app-served-protection.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { publishAskOf } from '../services/publish-requests/ask.js';
import { publishAskedFields } from '../services/app-publish-gate.js';

export function registerAppForkTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceListChanged: (agentGaii: string) => void,
    /** The session's caller, for the publish gate a new app passes (services/app-publish-gate.ts). */
    caller: () => CallerContext,
): void {
    // ── Tool 6: aimeat_app_fork ──
    mcp.registerTool(
        'aimeat_app_fork',
        {
            description: descriptionFor('aimeat_app_fork'),
            inputSchema: zodShapeFor('aimeat_app_fork'),
            annotations: annotationsFor('aimeat_app_fork'),
        },
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
            // Gate 2 — a paced source's bytes are not copied before the app is taken. A licence is
            // keyed on the buyer's OWNER GHII (app-store.ts), so it is asked of ownerGhiiOf(agentGaii),
            // the coordinate POST .../fork asks; an agent's own GAII holds no receipt.
            // The pacing amount is the latest version's, also for an older version (QA audit F10a-01).
            const current = await currentAppRow(storage, source, version);
            if (appIsPaced(config, current.manifest) && !sameOwner) {
                // The version copied: a single licence covers the version bought (feature-list audit #110).
                const hasLicense = await storage.hasValidLicense(ownerGhiiOf(agentGaii), source.ownerGaii, filename, undefined, source.versionNumber);
                if (!hasLicense) {
                    return { content: [{ type: 'text' as const, text: `This app has ${appToll(current.manifest)} morsels of pacing. Take it first (POST /v1/app-store/purchase), then fork it.` }], isError: true };
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
                    publishGate: publishAskOf({ storage, config }, caller()),
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
                            // Stored unlisted, not public yet: the owner approves (its next_step says what to tell them).
                            ...publishAskedFields(out.publishAsked),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return withCaughtError({ content: [{ type: 'text' as const, text: `Failed to fork app: ${(err as Error).message}` }], isError: true }, err);
            }
        },
    );
}
