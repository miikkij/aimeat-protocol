/**
 * @file src/services/app-urls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public address of an app, read-only: resolveAppUrls answers a batch of apps from
 *   one read of the subdomain table and assigns nothing. appOriginScheme is the scheme and port the
 *   app origin inherits from the apex baseUrl, shared with the writing sibling appOriginUrl
 *   (routes/apps/helpers.ts, which re-exports resolveAppUrls).
 * @structure appOriginScheme · resolveAppUrls
 * @usage const urls = await resolveAppUrls(config, storage, [{ owner, filename }]);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved from routes/apps/helpers.ts by extraction, so the roster service that
 *     sends an invitation reads the app's address; aimeat_app_manage calls the service in place of
 *     the route over loopback HTTP (secaudit 2026-10, M6). The history before the move is in
 *     routes/apps/helpers.ts (v1.1.0 and v1.3.0).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { localAccountName } from '../utils/gaii.js';

/**
 * Scheme + port for the app origin, inherited from the apex baseUrl so only the host
 * changes. Correct both in prod (https://apps.aimeat.io) and locally
 * (http://apps.localhost:40050).
 */
export function appOriginScheme(config: AimeatConfig): { scheme: string; portSuffix: string } {
    try {
        const base = new URL(config.baseUrl);
        return { scheme: base.protocol.replace(':', ''), portSuffix: base.port ? `:${base.port}` : '' };
    // eslint-disable-next-line aimeat/no-silent-catch -- keep https, no port
    } catch { /* keep https, no port */ }
    return { scheme: 'https', portSuffix: '' };
}

/** The account name, with a `@node-id` of this node removed; another node's identity stays whole. */
function bare(owner: string): string {
    return localAccountName(owner);
}

/**
 * Public app-origin URLs for a batch of apps, WITHOUT assigning anything. Reads the
 * subdomain table once and uses an app's assigned subdomain if it has one; every other
 * app gets the shared path form, which serves the same app. Returns a map keyed
 * `"<bare owner>/<filename>"`, empty when the app origin is not provisioned.
 *
 * appOriginUrl is the writing sibling: it mints a subdomain on first use, which is right
 * for a redirect a person just followed and wrong for a listing that touches 50 apps.
 */
export async function resolveAppUrls(
    config: AimeatConfig,
    storage: Storage,
    refs: Array<{ owner: string; filename: string }>,
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (refs.length === 0) return out;
    // No app origin on this node: an app opens on the node's own address, in inline mode. That
    // is the address a person can be handed, and the one the node prints for its own apps. It
    // also holds on a node that gains an app origin later, because the inline route redirects
    // to it (routes/apps/read.ts). This returned nothing until 2026-09-18, so aimeat_app_list
    // answered `url: null` and an agent asked how to open an app had a filename to offer.
    if (!config.appOriginEnabled || !config.appHost) {
        const base = config.baseUrl.replace(/\/+$/, '');
        for (const ref of refs) {
            const bareOwner = bare(ref.owner);
            out[`${bareOwner}/${ref.filename}`] = `${base}/v1/apps/${encodeURIComponent(bareOwner)}/${encodeURIComponent(ref.filename)}?mode=inline`;
        }
        return out;
    }

    const { scheme, portSuffix } = appOriginScheme(config);
    let byTarget = new Map<string, string>();
    try {
        const sites = await storage.listSubdomainSites();
        byTarget = new Map(sites.filter(s => s.enabled && s.kind === 'app').map(s => [s.target, s.subdomain]));
    } catch (err) {
        // The path form serves every app regardless, so a subdomain-table failure costs
        // a prettier URL and never the link itself.
        logger.warn('resolveAppUrls: fall through to path form', { error: String(err) });
    }

    for (const ref of refs) {
        const bareOwner = bare(ref.owner);
        const key = `${bareOwner}/${ref.filename}`;
        const sub = byTarget.get(key);
        out[key] = sub
            ? `${scheme}://${sub}.${config.appHost}${portSuffix}/`
            : `${scheme}://${config.appHost}${portSuffix}/${encodeURIComponent(bareOwner)}/${encodeURIComponent(ref.filename)}`;
    }
    return out;
}
