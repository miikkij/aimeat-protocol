/**
 * @file src/routes/apps/open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Opening an app that needs a sign-in (plan doc-mvcn6c7e4e5q, V2.2 and V2.3).
 *
 *   An app's own setting (`open_to`: signed-in, or one organism's members) or the node's signed-in
 *   content access decides who may open it (services/app/access.ts). A browser that opens an app
 *   carries no session on the page load, because the SPA keeps it in localStorage. So the app origin
 *   and the apex read send such a browser to /v1/app-open, the SPA page that holds the session; the
 *   page signs the person in if needed and asks POST /v1/apps/:owner/:filename/open with it. This
 *   route checks who the caller is, and answers the address to open: the app's origin (or the apex
 *   inline address on a node without app origins) with a short-lived grant the origin verifies
 *   (services/app/access-token.ts). The grant names the app and nothing else, as for an access code.
 *
 *   signInGateRefused() is the same decision for GET /v1/apps/:owner/:filename (routes/apps/read.ts),
 *   which also takes a grant this route handed out, so the apex inline address works the same way.
 * @structure signInGateRefused() · appReaderOf() · screenshotFollowsAccess() · screenshotGateRefused() · listedScreenshotUrl() · registerAppOpenRoutes()
 * @usage registerAppOpenRoutes(router, config, storage, canonicalOwner)   // from appsRouter
 * @version-history
 *   2026-11-12 — GET and POST /v1/apps/:owner/:filename/access-request: a person the app refuses
 *     because it is opened to one organism's members asks that organism's owners for access
 *     (routes/access-request.ts).
 *   2026-11-04 — signInGateRefused() asks signInGateOf() (services/app-read-gate.ts), the same decision
 *     moved unchanged, so the version list answers as the app read does; appReaderOf() builds its
 *     caller (codebase analysis 2026-11-03, item A1).
 *   2026-10-31 — screenshotGateRefused(): the screenshot of an app that needs a sign-in answers as the
 *     app does, unless its owner shows it to everyone; a listing's screenshot grant passes, and the
 *     answer is cached `private` (secaudit2026oct31w2 round 10, W2-12).
 *   v1.2.0 — 2026-10-19 — The grant carries the sign-in session it came from, so it stops opening the
 *     app when the person signs out (services/app-access-token.ts).
 *   v1.1.0 — 2026-10-18 — The grant carries `viewer`, the GHII of the signed-in person it was minted
 *     for; `sub` keeps naming the app owner (plan doc-mvcn6c7e4e5q, V2).
 *   v1.0.0 — 2026-10-17 — Initial.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AppRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { answerAccessRequest, answerAccessRequestState, type AccessRequestTarget } from '../access-request.js';
import { appNeedsSignIn, mayOpenApp } from '../../services/app/access.js';
import { signInGateOf, SIGN_IN_REFUSAL, type AppReader } from '../../services/app/read-gate.js';
import { isNodeAccount } from '../../services/audience.js';
import { appIsPaced } from '../../services/app/pacing.js';
import { appAccessGranted, appShotGranted, generateAppAccessToken, generateAppShotToken } from '../../services/app/access-token.js';
import { operatorOverride } from '../../services/operator-override.js';
import { appAccessTarget } from '../../services/organism-join-requests/access-targets.js';
import { validateBody } from '../../models/schemas.js';
import { AccessRequestBody } from '../../models/write-body-schemas.js';
import { isSameAccount } from '../../utils/same-account.js';
import { resolveIdentity } from '../../utils/gaii.js';
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
  const gate = await signInGateOf(storage, config, app, current, appReaderOf(req, canonicalOwner, operatorReads, app));
  if (!gate) return false;
  if (!gate.account && (req.headers.accept ?? '').includes('text/html')) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, appOpenPage(app));
    return true;
  }
  const refusal = gate.account ? SIGN_IN_REFUSAL.account : SIGN_IN_REFUSAL.none;
  res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
  return true;
}

/**
 * The caller of an apex app read, for services/app/read-gate.ts. `app` names the app whose opening
 * grant (`?access=`) counts; without it no grant is read.
 */
export function appReaderOf(
  req: Request, canonicalOwner: CanonicalOwner, operatorReads: () => Promise<boolean>,
  app?: Pick<AppRecord, 'ownerName' | 'filename'>,
): AppReader {
  return {
    auth: req.auth,
    viewerOwner: async () => (await canonicalOwner(req)).owner,
    operatorReads,
    ...(app ? { accessGranted: () => appAccessGranted(req.query.access, app.ownerName, app.filename) } : {}),
  };
}

/** The app fields the screenshot decisions read; a listing row (AppSummaryRecord) carries them. */
type ListedApp = Pick<AppRecord, 'access' | 'manifest' | 'ownerName' | 'filename'>;

/**
 * Whether the screenshot of `app` follows who may open it: the app needs a sign-in (its own setting or
 * the node's) and its owner has not chosen to show the screenshot to everyone. An app anyone may open
 * answers false, so its screenshot stays public (secaudit2026oct31w2 round 10, W2-12).
 */
export function screenshotFollowsAccess(config: AimeatConfig, app: ListedApp): boolean {
  return appNeedsSignIn(config, app) && app.manifest?.screenshotPublic !== true;
}

/**
 * The gate of GET /v1/apps/:owner/:filename/screenshot. Answers true when it has already answered the
 * request, with the app's own refusal (signInGateRefused). Passes a screenshot grant from a listing
 * (appShotGranted), and everyone signInGateRefused passes. Where the screenshot follows the app's
 * access, the answer is sent `private`, so no shared cache keeps it for somebody else.
 */
export async function screenshotGateRefused(
  req: Request, res: Response, config: AimeatConfig, storage: Storage, app: AppRecord, canonicalOwner: CanonicalOwner,
): Promise<boolean> {
  if (!screenshotFollowsAccess(config, app)) return false;
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (await appShotGranted(req.query.shot, app.ownerName, app.filename)) return false;
  let operatorRead: boolean | undefined;
  const operatorReads = async (): Promise<boolean> => (operatorRead ??= await operatorOverride(
    storage, config, req.auth, { ownerOf: app.ownerName, area: 'app', action: 'read', subject: app.filename }));
  return signInGateRefused(req, res, config, storage, app, app, canonicalOwner, operatorReads);
}

/**
 * The screenshot address a listing hands this caller, for an app that has a screenshot. An app whose
 * screenshot is public gets the plain address, as before. Where the screenshot follows the app's
 * access, a caller who may open the app (its owner, an operator, an account the app's setting admits)
 * gets the address with a screenshot grant, because an <img> carries no session; anybody else gets
 * null, so the card shows no picture.
 */
export async function listedScreenshotUrl(
  config: AimeatConfig, storage: Storage, app: ListedApp, auth: Request['auth'], viewer: { isOwn: boolean; isOperator: boolean },
): Promise<string | null> {
  const base = `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/screenshot`;
  if (!screenshotFollowsAccess(config, app)) return base;
  const may = viewer.isOwn || viewer.isOperator || (isNodeAccount(auth) && await mayOpenApp(storage, config, app, auth));
  return may ? `${base}?shot=${encodeURIComponent(await generateAppShotToken(app.ownerName, app.filename))}` : null;
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
    // `sub` stays the app owner, which the origin checks; `viewer` names the person the grant was
    // handed to. The app origin moves the grant from the address to a cookie (routes/origin-grant-cookie.ts).
    const grant = await generateAppAccessToken({ sub: app.ownerGaii, filename: app.filename, viewer: resolveIdentity(req.auth!, config.nodeId), session: req.auth!.sessionId });
    const sep = target.includes('?') ? '&' : '?';
    res.setHeader('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { url: `${target}${sep}access=${encodeURIComponent(grant)}`, expires_in: 3600 }));
  });

  /** The route's target, or null after answering the 404 a missing or hidden app gets. */
  const requestedTarget = async (req: Request, res: Response): Promise<AccessRequestTarget | null> => {
    const target = await appAccessTarget(storage, config, req.auth, `${req.params.owner as string}/${req.params.filename as string}`);
    if (!target) res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No app here.'));
    return target;
  };

  /* ── GET /v1/apps/:owner/:filename/access-request — what the refusal page shows this person ── */
  // `social:write` on the read too: it says whether THIS caller may file a request, so it asks the
  // permission the request asks, and the one tool that does both (aimeat_access_request) holds one word.
  router.get('/v1/apps/:owner/:filename/access-request', requireAuth(), requireRole('agent'), requireScope('social:write'), async (req: Request, res: Response) => {
    const target = await requestedTarget(req, res);
    if (target) await answerAccessRequestState(req, res, config, storage, target);
  });

  /* ── POST /v1/apps/:owner/:filename/access-request — ask the organism's owners for access ── */
  // `social:write`, the permission POST /v1/organisms/:id/join asks: both file a join request.
  router.post('/v1/apps/:owner/:filename/access-request', requireAuth(), requireRole('agent'), requireScope('social:write'), validateBody(AccessRequestBody, config.nodeId), async (req: Request, res: Response) => {
    const target = await requestedTarget(req, res);
    if (target) await answerAccessRequest(req, res, config, storage, target);
  });
}
