/**
 * @file src/routes/apps/helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared helpers for the app-catalog routes: appOriginUrl (H-2 app-origin redirect
 *   target builder), its read-only sibling resolveAppUrls (batch, assigns nothing) and the
 *   CanonicalOwner closure type. Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @structure
 *   - CanonicalOwner — authenticated-caller → owner resolver closure type
 *   - AppTargetFor / appTargetOr — whose bucket this act lands in, or the refusal to send
 *   - appOriginUrl() — WRITES: assigns a subdomain on first use, then builds the URL
 *   - resolveAppUrls() — READ-ONLY, re-exported from services/app-urls.ts
 * @version-history
 *   v1.3.2 — 2026-10-05 — appOriginScheme and resolveAppUrls moved to services/app-urls.ts (re-exported
 *     here), so the roster service that sends an invitation reads the app's address; aimeat_app_manage
 *     calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.3.1 — 2026-09-26 — bare() is localAccountName (utils/gaii.ts), which keeps an identity of
 *     another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.3.0 — 2026-09-18 — resolveAppUrls answers on a node WITHOUT an app origin too: the node's
 *     own address in inline mode, which is how such a node opens an app anyway. It returned
 *     nothing, so aimeat_app_list said `url: null`, and the cold-agent baseline measured the
 *     cost: three runs of three, the agent told the person their apps had no address. Ruled by
 *     the developer the same day.
 *   v1.2.0 — 2026-09-08 — AppTargetFor and appTargetOr: an app write can land in ANOTHER owner's
 *     bucket when they granted the caller a development right, and one helper asks that question so
 *     that thirty doors do not each carry their own version of the answer.
 *   v1.1.0 — 2026-08-09 — resolveAppUrls: the same public URL without the subdomain assignment,
 *     so a read-only lister can serve it. appOriginScheme extracted (shared by both).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AppDevAct, DelegatedDev } from '../../services/app-dev-grant.js';
import { error } from '../../middleware/envelope.js';
import { ensureAppSubdomain } from '../subdomains.js';
import { logger } from '../../utils/logger.js';
import { localAccountName } from '../../utils/gaii.js';
import { appOriginScheme, resolveAppUrls } from '../../services/app-urls.js';

// Read-only sibling of appOriginUrl, in services/app-urls.ts so a service can read an app's address.
export { resolveAppUrls };

/**
 * The canonical-owner resolver closure built in appsRouter and passed to each route
 * group. Resolves the authenticated caller to a single bare owner name + owner GHII.
 */
export type CanonicalOwner = (req: Express.Request) => Promise<{ owner: string; ownerGhii: string }>;

/** What a door gets back when it asks whose app it is about to touch. */
export type AppTargetOutcome =
  | { ok: true; owner: string; ownerGhii: string; delegated: DelegatedDev | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * The resolver every app write door asks: WHOSE bucket does this act land in?
 *
 * Built once in appsRouter and handed to each route group. It reads the owner the request names -
 * the `:owner` path segment where there is one, `owner` in the body where there is not - and answers
 * either with a bucket or with the refusal to send back. `act` is what the caller means to do, and
 * it is what a rung is measured against.
 */
export type AppTargetFor = (req: Request, act: AppDevAct) => Promise<AppTargetOutcome>;

/**
 * Ask, and on a refusal write it and return null so the handler can `return`.
 *
 * A helper rather than three lines in thirty places, because those three lines are the whole
 * authorisation of an app write and a door that gets them subtly wrong looks exactly like a door
 * that gets them right.
 */
export async function appTargetOr(
  appTarget: AppTargetFor, config: AimeatConfig, req: Request, res: Response, act: AppDevAct,
): Promise<{ owner: string; ownerGhii: string; delegated: DelegatedDev | null } | null> {
  const t = await appTarget(req, act);
  if (!t.ok) {
    res.status(t.status).json(error(config.nodeId, t.code, t.message));
    return null;
  }
  return { owner: t.owner, ownerGhii: t.ownerGhii, delegated: t.delegated };
}

/** The account name, with a `@node-id` of this node removed; another node's identity stays whole. */
function bare(owner: string): string {
    return localAccountName(owner);
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
