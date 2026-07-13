/**
 * @file src/routes/apps/helpers.ts
 * @description Shared helpers for the app-catalog routes: appOriginUrl (H-2 app-origin redirect
 *   target builder) and the CanonicalOwner closure type. Extracted from src/routes/apps.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { ensureAppSubdomain } from '../subdomains.js';

/**
 * The canonical-owner resolver closure built in appsRouter and passed to each route
 * group. Resolves the authenticated caller to a single bare owner name + owner GHII.
 */
export type CanonicalOwner = (req: Express.Request) => Promise<{ owner: string; ownerGhii: string }>;

/**
 * Build the app-origin URL an apex app request should 301 to (H-2). Prefers an
 * assigned per-app subdomain (`https://<sub>.apps.<apex>/`, which also isolates the
 * app from other apps), falling back to the shared path form
 * (`https://apps.<apex>/<owner>/<filename>`). Caller guarantees config.appHost is set.
 */
export async function appOriginUrl(config: AimeatConfig, storage: Storage, owner: string, filename: string): Promise<string> {
    // Inherit scheme + port from the apex baseUrl and only swap the host, so the redirect is
    // correct both in prod (https://apps.aimeat.io) and locally (http://apps.localhost:40050).
    let scheme = 'https';
    let portSuffix = '';
    try {
        const base = new URL(config.baseUrl);
        scheme = base.protocol.replace(':', '');
        portSuffix = base.port ? `:${base.port}` : '';
    } catch { /* keep https, no port */ }
    const bareOwner = owner.includes('@') ? owner.split('@')[0] : owner;
    try {
        // Auto-assign a per-app subdomain on first open so seamless SSO works with no manual step
        // (existing apps migrate transparently); fall back to the shared path form only if none is free.
        const sub = await ensureAppSubdomain(storage, config, bareOwner, filename);
        if (sub) return `${scheme}://${sub}.${config.appHost}${portSuffix}/`;
    } catch { /* fall through to path form */ }
    return `${scheme}://${config.appHost}${portSuffix}/${encodeURIComponent(bareOwner)}/${encodeURIComponent(filename)}`;
}
