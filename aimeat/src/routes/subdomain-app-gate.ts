/**
 * @file src/routes/subdomain-app-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which app an app origin serves, and whether it needs a grant first: resolveAppTarget,
 *   resolveServableApp, appIsRestricted and unlockRedirect. A pure extraction from subdomains.ts when
 *   that file reached the 800-line ceiling; subdomains.ts re-exports the three exported functions, so
 *   no importer changed.
 * @structure resolveAppTarget · resolveServableApp · appIsRestricted · unlockRedirect
 * @usage import { resolveServableApp, appIsRestricted, unlockRedirect } from './subdomain-app-gate.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Moved unchanged from routes/subdomains.ts (v1.29.0).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { appIsPaced } from '../services/app-pacing.js';

/** Resolve an "owner/filename" app target to its latest published record. */
export async function resolveAppTarget(storage: Storage, target: string): Promise<AppRecord | null> {
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) return null;
  const owner = target.slice(0, slash);
  const filename = target.slice(slash + 1);
  let app = await storage.getAppByOwnerName(owner, filename);
  // Backward-compat: target may carry the full GHII as the owner segment
  const bare = localAccountName(owner);
  if (!app && bare !== owner) {
    app = await storage.getAppByOwnerName(bare, filename);
  }
  return app;
}

/** The app an app origin may serve: null when there is none or an operator hid it. The origin holds
 *  no session, so the owner and an operator look like strangers here; the apex keeps their pass. */
export async function resolveServableApp(storage: Storage, target: string): Promise<AppRecord | null> {
  const app = await resolveAppTarget(storage, target);
  return app && !app.operatorHidden ? app : null;
}

/** True when the app must not be served openly at a subdomain root. */
export function appIsRestricted(config: AimeatConfig, app: AppRecord): boolean {
  if (app.accessCode) return true;
  if (appIsPaced(config, app.manifest)) return true;
  return false;
}

/**
 * A CODE-gated app met by a browser that holds no usable grant: send it to the apex, where the
 * code form already lives, instead of the uniform 404. Returns true when the redirect was sent.
 *
 * Why here. The public address of every app is its own origin — it is what the catalog opens, what
 * `aimeat_app_list` hands out and what a person shares — but the code form only ever existed on the
 * apex, so a stranger following that link, and an owner reloading after the hour-long grant died,
 * both got `{"error":{"code":"NOT_FOUND"}}` with no way back to the field. The gate is not moved and
 * no code is checked here: this origin has no session and still verifies nothing but a signed grant.
 * It only points a human at the door.
 *
 * Three conditions, each load-bearing:
 *   - An ACCESS CODE, never a pacing amount. An app taken first for its pacing refuses anything without a Bearer, which is the one
 *     credential a browser navigation cannot carry, so a form would only dead-end more slowly.
 *   - A browser NAVIGATION (`Accept: text/html`), the same test the apex unlock page uses. An API
 *     caller, an agent and a script's own request keep the uniform 404 they contract for.
 *   - `unlock` absent. The apex stamps it back onto the grant it mints, so a grant that fails to
 *     verify HERE (clock skew, a rotated node key) bounces exactly once and then 404s.
 *
 * The disclosure this trades away, deliberately: a code-gated app's origin stops being
 * indistinguishable from an unmapped subdomain for a browser. The apex has always said as much to
 * the same visitor — it answers the code form rather than 404 — so this aligns the two doors
 * instead of opening a new one. Everything else on this origin keeps the uniform 404.
 */
export function unlockRedirect(req: Request, res: Response, config: AimeatConfig, app: AppRecord): boolean {
  if (!app.accessCode) return false;
  if (!(req.headers.accept ?? '').includes('text/html')) return false;
  if (req.query.unlock === '1') return false;
  const target = `${config.baseUrl}/v1/apps/${encodeURIComponent(app.ownerName)}`
    + `/${encodeURIComponent(app.filename)}?mode=inline&unlock=1`;
  // no-store for the same reason the apex grant redirect carries it: this address is a step in an
  // unlock, and a cached copy of it would send the next visit somewhere it no longer belongs.
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, target);
  return true;
}
