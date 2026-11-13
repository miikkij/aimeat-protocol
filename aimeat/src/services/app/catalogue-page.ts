/**
 * @file src/services/app/catalogue-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One page of the app catalogue for one viewer: who may ask "my apps" (own) and "the apps
 *   I help build" (building), the read that answers each, and the per-app download and fork counts.
 *   GET /v1/apps and the MCP tool aimeat_app_list each did all of it. The route refused own and
 *   building to a caller with no account of its own (no session, or the anonymous credential the node
 *   mints in anonymous mode) with 401, because "nobody anonymous has an own, and answering with an
 *   empty list looks like an answer and is not one"; the tool answered that credential an empty list
 *   (structure programme 2026-11, unit 2b, B7).
 *
 *   WHAT STAYS WITH EACH SURFACE. The list options (each surface's own paging bounds, sort and
 *   filters) and the presentation of a row. The building answer is filtered by the same options and
 *   paged with the route's arithmetic, which gives the tool's own answer for the tool's clamped values.
 * @structure CatalogueViewer · CataloguePage · catalogueAppPage(storage, config, viewer, ask)
 * @usage
 *   const page = await catalogueAppPage(storage, config, viewer, { own, building, list: opts });
 *   if ('refusal' in page) return unauthorized(page.refusal);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B7).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AppListOptions, AppSummaryRecord } from '../../storage/types/apps.js';
import { listAppsBuiltFor } from './dev-grant.js';
import { appToll } from './pacing.js';

/** Who reads the catalogue. `ownerGhii` is absent for a request with no credential. */
export interface CatalogueViewer {
    /** The identity rights are held under (resolveIdentity, or the session's GAII). */
    principal: string;
    ownerGhii: string | undefined;
    /** The node's shared anonymous principal (isAnonymousPrincipal). */
    anonymous: boolean;
}

export type CataloguePage =
    | { refusal: 'own' | 'building' }
    | { apps: AppSummaryRecord[]; total: number; downloadsByApp: Record<string, number>; forksByApp: Record<string, number> };

/**
 * The page `ask.list` names. With `own`, the list is narrowed to the viewer's own apps; with
 * `building`, it is the apps somebody else asked the viewer to help build. Both are refused to a
 * viewer with no account of its own.
 */
export async function catalogueAppPage(
    storage: Storage, config: AimeatConfig, viewer: CatalogueViewer,
    ask: { own: boolean; building: boolean; list: AppListOptions },
): Promise<CataloguePage> {
    const signedIn = !!viewer.ownerGhii && !viewer.anonymous;
    if (ask.own && !signedIn) return { refusal: 'own' };
    if (ask.building && !signedIn) return { refusal: 'building' };

    const list: AppListOptions = { ...ask.list, viewerGhii: viewer.ownerGhii, ...(ask.own ? { ownerGaii: viewer.ownerGhii } : {}) };
    let apps: AppSummaryRecord[];
    let total: number;
    if (ask.building) {
        const q = (list.q ?? '').toLowerCase();
        const built = (await listAppsBuiltFor(storage, config, { principal: viewer.principal, viewerGhii: viewer.ownerGhii }))
            .filter(app => (!list.category || app.manifest.category === list.category)
                && (!list.tag || app.manifest.tags?.includes(list.tag))
                && (!list.freeOnly || !appToll(app.manifest))
                && (!q || `${app.manifest.name} ${app.manifest.description}`.toLowerCase().includes(q)));
        total = built.length;
        const offset = Math.max(0, list.offset ?? 0);
        apps = built.slice(offset, offset + Math.max(1, list.limit ?? 50));
    } else {
        ({ apps, total } = await storage.listApps(list));
    }

    // Per-app metrics in two batch queries for the whole page.
    const refs = apps.map(a => ({ ownerGaii: a.ownerGaii, filename: a.filename }));
    const [downloadsByApp, forksByApp] = await Promise.all([
        storage.getAppDownloadsForApps(refs),
        storage.countAppForksForApps(refs),
    ]);
    return { apps, total, downloadsByApp, forksByApp };
}
