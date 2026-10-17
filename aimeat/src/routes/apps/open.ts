/**
 * @file src/routes/apps/open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Opening an app that needs a sign-in (plan doc-mvcn6c7e4e5q, V2.2 and V2.3).
 *
 *   An app's own setting (`open_to`: signed-in, or one organism's members) or the node's signed-in
 *   content access decides who may open it (services/app-access.ts). A browser that opens an app
 *   carries no session on the page load, because the SPA keeps it in localStorage. So the app origin
 *   and the apex read send such a browser to /v1/app-open, the SPA page that holds the session; the
 *   page signs the person in if needed and asks POST /v1/apps/:owner/:filename/open with it. This
 *   route checks who the caller is, and answers the address to open: the app's origin (or the apex
 *   inline address on a node without app origins) with a short-lived grant the origin verifies
 *   (services/app-access-token.ts). The grant names the app and nothing else, as for an access code.
 *
 *   signInGateRefused() is the same decision for GET /v1/apps/:owner/:filename (routes/apps/read.ts),
 *   which also takes a grant this route handed out, so the apex inline address works the same way.
 * @structure signInGateRefused() · registerAppOpenRoutes()
 * @usage registerAppOpenRoutes(router, config, storage, canonicalOwner)   // from appsRouter
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { appNeedsSignIn, mayOpenApp } from '../../services/app-access.js';
import { isNodeAccount } from '../../services/audience.js';
import { appIsPaced } from '../../services/app-pacing.js';
import { appAccessGranted, generateAppAccessToken } from '../../services/app-access-token.js';
import { operatorOverride } from '../../services/operator-override.js';
import { isSameAccount } from '../../utils/same-account.js';
import { resolveAppTarget } from '../subdomain-app-gate.js';
import { appOriginUrl, type CanonicalOwner } from './helpers.js';

/** The SPA page that opens a sign-in-gated app (registered in routes/portal.ts and spa.html). */
export function appOpenPage(app: Pick<AppRecord, 'ownerName' | 'filename'>): string {
  return `/v1/app-open?app=${encodeURIComponent(`${app.ownerName}/${app.filename}`)}`;
}

/**
 * The sign-in gate of the apex read. Answers true when it has already answered the request: a
 * stranger's browser goes to the open page, an API caller gets 401 (no account) or 403 (an account
 * the app does not open for). The owner, a grant from POST .../open and an operator pass.
 */
export async function signInGateRefused(
  req: Request, res: Response, config: AimeatConfig, storage: Storage,
  app: AppRecord, current: AppRecord, canonicalOwner: CanonicalOwner, operatorReads: () => Promise<boolean>,
): Promise<boolean> {
  if (!appNeedsSignIn(config, current)) return false;
  if (await appAccessGranted(req.query.access, app.ownerName, app.filename)) return false;
  const account = isNodeAccount(req.auth);
  if (account) {
    const { owner: viewerOwner } = await canonicalOwner(req);
    if (isSameAccount(viewerOwner, app.ownerName) || await mayOpenApp(storage, config, current, req.auth) || await operatorReads()) return false;
  }
  if (!account && (req.headers.accept ?? '').includes('text/html')) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, appOpenPage(app));
    return true;
  }
  res.status(account ? 403 : 401).json(error(config.nodeId, account ? 'ACCESS_DENIED' : 'SIGN_IN_REQUIRED', account
    ? 'This app opens for the people its owner chose, and you are not among them.'
    : 'This app opens for signed-in people only. Sign in and open it again.'));
  return true;
}

export function registerAppOpenRoutes(router: Router, config: AimeatConfig, storage: Storage, canonicalOwner: CanonicalOwner): void {
  /* ── POST /v1/apps/:owner/:filename/open — the address that opens a gated app, with a grant ── */
  // The owner role: the person in their own session (the /v1/app-open page) opens an app. An app grant
  // or an agent token has no use for another app's opening grant.
  router.post('/v1/apps/:owner/:filename/open', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    const app = await resolveAppTarget(storage, `${req.params.owner as string}/${req.params.filename as string}`);
    const notFound = () => res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No app here.'));
    if (!app) { notFound(); return; }
    const { owner: viewerOwner } = await canonicalOwner(req);
    const isOwner = isNodeAccount(req.auth) && isSameAccount(viewerOwner, app.ownerName);
    let operatorRead: boolean | undefined;
    const operatorReads = async (): Promise<boolean> => (operatorRead ??= await operatorOverride(
      storage, config, req.auth, { ownerOf: app.ownerName, area: 'app', action: 'read', subject: app.filename }));

    // A hidden app answers like a missing one, as the apex read does.
    if (app.operatorHidden && !isOwner && !(await operatorReads())) { notFound(); return; }
    if (!isOwner && !(await mayOpenApp(storage, config, app, req.auth)) && !(await operatorReads())) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'This app opens for the people its owner chose, and you are not among them.'));
      return;
    }
    if (app.accessCode && !isOwner && !(await operatorReads())) {
      const code = (req.body as { code?: unknown } | undefined)?.code;
      if (code !== app.accessCode) {
        res.status(403).json(error(config.nodeId, 'ACCESS_CODE_REQUIRED', 'This app also asks for its access code. Send it as { "code": "…" }.'));
        return;
      }
    }
    if (appIsPaced(config, app.manifest) && !isOwner) {
      res.status(409).json(error(config.nodeId, 'PACED_APP', 'This app is taken through the store first; open it from there.'));
      return;
    }
    const target = config.appOriginEnabled && config.appHost
      ? await appOriginUrl(config, storage, app.ownerName, app.filename)
      : `${config.baseUrl}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}?mode=inline`;
    const grant = await generateAppAccessToken({ sub: app.ownerGaii, filename: app.filename });
    const sep = target.includes('?') ? '&' : '?';
    res.setHeader('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { url: `${target}${sep}access=${encodeURIComponent(grant)}`, expires_in: 3600 }));
  });
}
