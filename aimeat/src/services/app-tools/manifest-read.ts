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
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage } from '../../storage/interface.js';
import { appIdFromToolsKey } from '../../models/app-tool-schemas.js';
import { logger } from '../../utils/logger.js';

/**
 * The app ids this owner publishes a tool manifest for — the signpost on an APP_TOOLS_NOT_FOUND.
 * A cross-owner caller sees only the public ones, matching the read gate itself, so the hint can
 * never reveal that a private manifest exists.
 */
export async function appToolManifestIds(storage: Storage, ownerGhii: string, includePrivate: boolean): Promise<string[]> {
    try {
        const recs = await storage.listMemory(ownerGhii, { prefix: 'apps.' });
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
