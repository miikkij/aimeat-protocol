/**
 * @file src/services/app-tools/manifest-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app ids an owner publishes a tool manifest for: the signpost an APP_TOOLS_NOT_FOUND
 *   answer carries. mcp/commerce.ts (aimeat_app_tools_get) and mcp/exchange-run.ts
 *   (aimeat_app_tool_invoke) each held a copy of this function; it lives here once since 2026-11-13,
 *   unchanged (CLAUDE.md, Backend: one capability, one implementation).
 * @structure resolveToolManifestId · appToolManifestIds · loadPublicToolManifest
 * @usage const near = await appToolManifestIds(storage, ownerGhii, includePrivate);
 * @version-history
 *   v1.3.0 — 2026-11-20 — resolveToolManifestId: the manifest a name without `.html` stands for, both
 *     MCP tools ask it. appToolManifestIds names the manifests nearest the name asked first, and
 *     without `.html`; the first twelve in the alphabet never named `lifecycle-central` for its owner.
 *   v1.2.0 — 2026-11-14 — loadPublicToolManifest: the invoke read both surfaces ask (unit 2b, B14).
 *   v1.1.0 — 2026-11-14 — Another account's hint leaves out the manifest of an app the operator hid (unit 2b, B12).
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage } from '../../storage/interface.js';
import { withoutHiddenToolManifests } from '../app/tools-manifest-reach.js';
import { appIdFromToolsKey, appToolsKey, AppToolsDocSchema, type AppTool } from '../../models/app-tool-schemas.js';
import { logger } from '../../utils/logger.js';
import { appDisplayName, appFilenameCandidates, findAppFilename, splitAppRef } from '../app/app-ref.js';

/**
 * The app id a tool manifest is read under, for a name a caller sent (`shop`, `shop.html`,
 * `owner/shop`): the owner's app or draft first (services/app/app-ref.ts), and when no app matches,
 * the first candidate that has a manifest, because a manifest may be written before its app is
 * published (services/app/tools-key.ts). A name nothing matches comes back as findAppFilename names it.
 */
export async function resolveToolManifestId(
    storage: Pick<Storage, 'appFilenamesAmong' | 'getMemory'>, ownerName: string, ownerGhii: string, ref: string,
): Promise<string> {
    const raw = String(ref ?? '').trim();
    // A manifest stored under the id exactly as given wins, whatever its shape: an id may itself hold
    // a slash (`alice/dup-app`), and the exact name always comes first (services/app/app-ref.ts).
    if (raw && await storage.getMemory(ownerGhii, appToolsKey(raw))) return raw;
    const found = await findAppFilename(storage, { ownerName }, raw);
    if (found.filename) return found.filename;
    if (found.foreign) return raw;
    for (const c of appFilenameCandidates(found.name)) {
        if (c !== raw && await storage.getMemory(ownerGhii, appToolsKey(c))) return c;
    }
    return found.name || raw;
}

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
export async function appToolManifestIds(storage: Storage, ownerGhii: string, includePrivate: boolean, asked?: string): Promise<string[]> {
    try {
        const all = await storage.listMemory(ownerGhii, { prefix: 'apps.' });
        // Another account's hint names no manifest of an app the operator hid (services/app/tools-manifest-reach.ts).
        const recs = includePrivate ? all : await withoutHiddenToolManifests(storage, all, null);
        // Shown as a caller may send them, without `.html` (services/app/app-ref.ts). The twelve are the
        // ones nearest the name asked, not the first twelve in the alphabet: an owner with more
        // manifests than that never saw the right one named (2026-11-20, `lifecycle-central`).
        const want = asked ? appDisplayName(splitAppRef(asked).name).toLowerCase() : '';
        const nearness = (id: string): number => {
            if (!want) return 2;
            const n = id.toLowerCase();
            if (n.includes(want) || want.includes(n)) return 0;
            return want.split(/[-_.]/).some(part => part.length > 2 && n.includes(part)) ? 1 : 2;
        };
        return [...new Set(recs
            .filter(r => includePrivate || r.visibility === 'public')
            .map(r => appIdFromToolsKey(r.key))
            .filter((id): id is string => !!id)
            .map(appDisplayName))]
            .sort((a, b) => nearness(a) - nearness(b) || a.localeCompare(b))
            .slice(0, 12);
    } catch (err) {
        // The hint is a courtesy on a path that has already failed; never turn it into a second
        // failure — but say so, or a broken listing looks like an owner with no manifests.
        logger.warn('app-tool manifest hint could not be built', { ownerGhii, error: String(err) });
        return [];
    }
}
