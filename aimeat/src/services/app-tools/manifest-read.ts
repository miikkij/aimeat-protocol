/**
 * @file src/services/app-tools/manifest-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app ids an owner publishes a tool manifest for: the signpost an APP_TOOLS_NOT_FOUND
 *   answer carries. mcp/commerce.ts (aimeat_app_tools_get) and mcp/exchange-run.ts
 *   (aimeat_app_tool_invoke) each held a copy of this function; it lives here once since 2026-11-13,
 *   unchanged (CLAUDE.md, Backend: one capability, one implementation).
 * @structure appToolManifestIds
 * @usage const near = await appToolManifestIds(storage, ownerGhii, includePrivate);
 * @version-history
 *   v1.2.0 — 2026-11-14 — loadPublicToolManifest: the invoke read both surfaces ask (unit 2b, B14).
 *   v1.1.0 — 2026-11-14 — Another account's hint leaves out the manifest of an app the operator hid (unit 2b, B12).
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage } from '../../storage/interface.js';
import { withoutHiddenToolManifests } from '../app/tools-manifest-reach.js';
import { appIdFromToolsKey, appToolsKey, AppToolsDocSchema, type AppTool } from '../../models/app-tool-schemas.js';
import { logger } from '../../utils/logger.js';

/** An app's public tool manifest as an invoke reads it: absent (missing or not public), malformed, or its tools. */
export type PublicToolManifest =
    | { state: 'absent' }
    | { state: 'malformed' }
    | { state: 'ok'; tools: AppTool[] };

/**
 * The public tool manifest of `ownerName`/`filename` for an invoke. POST .../webmcp/tools/:tool and
 * aimeat_app_tool_invoke both ask it, so a manifest that does not parse is INVALID_TOOL_MANIFEST on
 * both, as the checkout resolver and the extension purchase already answer it; the route answered it
 * as absent and the tool as malformed (structure programme 2026-11, unit 2b, B14).
 */
export async function loadPublicToolManifest(
    storage: Storage, nodeId: string, ownerName: string, filename: string,
): Promise<PublicToolManifest> {
    const rec = await storage.getMemory(`${ownerName}@${nodeId}`, appToolsKey(filename));
    if (!rec || rec.visibility !== 'public') return { state: 'absent' };
    const parsed = AppToolsDocSchema.safeParse(rec.value);
    return parsed.success ? { state: 'ok', tools: parsed.data.tools } : { state: 'malformed' };
}

/**
 * The app ids this owner publishes a tool manifest for — the signpost on an APP_TOOLS_NOT_FOUND.
 * A cross-owner caller sees only the public ones, matching the read gate itself, so the hint can
 * never reveal that a private manifest exists.
 */
export async function appToolManifestIds(storage: Storage, ownerGhii: string, includePrivate: boolean): Promise<string[]> {
    try {
        const all = await storage.listMemory(ownerGhii, { prefix: 'apps.' });
        // Another account's hint names no manifest of an app the operator hid (services/app/tools-manifest-reach.ts).
        const recs = includePrivate ? all : await withoutHiddenToolManifests(storage, all, null);
        return recs
            .filter(r => includePrivate || r.visibility === 'public')
            .map(r => appIdFromToolsKey(r.key))
            .filter((id): id is string => !!id)
            .sort()
            .slice(0, 12);
    } catch (err) {
        // The hint is a courtesy on a path that has already failed; never turn it into a second
        // failure — but say so, or a broken listing looks like an owner with no manifests.
        logger.warn('app-tool manifest hint could not be built', { ownerGhii, error: String(err) });
        return [];
    }
}
