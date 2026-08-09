/**
 * @file src/routes/apps/helpers.ts
 * @description Shared helpers for the app-catalog routes: appOriginUrl (H-2 app-origin redirect
 *   target builder), its read-only sibling resolveAppUrls (batch, assigns nothing) and the
 *   CanonicalOwner closure type. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @structure
 *   - CanonicalOwner — authenticated-caller → owner resolver closure type
 *   - appOriginScheme() — scheme + port inherited from the apex baseUrl
 *   - appOriginUrl() — WRITES: assigns a subdomain on first use, then builds the URL
 *   - resolveAppUrls() — READ-ONLY: one listSubdomainSites() for a batch of apps
 * @version-history
 *   v1.1.0 — 2026-08-09 — resolveAppUrls: the same public URL without the subdomain assignment,
 *     so a read-only lister can serve it. appOriginScheme extracted (shared by both).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { ensureAppSubdomain } from '../subdomains.js';
import { logger } from '../../utils/logger.js';

/**
 * The canonical-owner resolver closure built in appsRouter and passed to each route
 * group. Resolves the authenticated caller to a single bare owner name + owner GHII.
 */
export type CanonicalOwner = (req: Express.Request) => Promise<{ owner: string; ownerGhii: string }>;

/**
 * Scheme + port for the app origin, inherited from the apex baseUrl so only the host
 * changes. Correct both in prod (https://apps.aimeat.io) and locally
 * (http://apps.localhost:40050).
 */
function appOriginScheme(config: AimeatConfig): { scheme: string; portSuffix: string } {
    try {
        const base = new URL(config.baseUrl);
        return { scheme: base.protocol.replace(':', ''), portSuffix: base.port ? `:${base.port}` : '' };
    // eslint-disable-next-line aimeat/no-silent-catch -- keep https, no port
    } catch { /* keep https, no port */ }
    return { scheme: 'https', portSuffix: '' };
}

/** The bare owner name, with any `@node-id` suffix stripped. */
function bare(owner: string): string {
    return owner.includes('@') ? owner.split('@')[0] : owner;
}

/**
 * Build the app-origin URL an apex app request should 301 to (H-2). Prefers an
 * assigned per-app subdomain (`https://<sub>.apps.<apex>/`, which also isolates the
 * app from other apps), falling back to the shared path form
 * (`https://apps.<apex>/<owner>/<filename>`). Caller guarantees config.appHost is set.
 *
 * ASSIGNS a subdomain when the app has none. A caller that must not write (a listing,
 * a read-only tool) uses resolveAppUrls instead.
 */
export async function appOriginUrl(config: AimeatConfig, storage: Storage, owner: string, filename: string): Promise<string> {
    const { scheme, portSuffix } = appOriginScheme(config);
    const bareOwner = bare(owner);
    try {
        // Auto-assign a per-app subdomain on first open so seamless SSO works with no manual step
        // (existing apps migrate transparently); fall back to the shared path form only if none is free.
        const sub = await ensureAppSubdomain(storage, config, bareOwner, filename);
        if (sub) return `${scheme}://${sub}.${config.appHost}${portSuffix}/`;
    } catch (err) { logger.warn('appOriginUrl: fall through to path form', { error: String(err) }); }
    return `${scheme}://${config.appHost}${portSuffix}/${encodeURIComponent(bareOwner)}/${encodeURIComponent(filename)}`;
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
    if (!config.appOriginEnabled || !config.appHost || refs.length === 0) return out;

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
