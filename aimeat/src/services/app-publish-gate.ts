/**
 * @file src/services/app-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that make an app public (plan doc-mvcn6c7e4e5q, V4).
 *
 *   PUBLIC, FOR AN APP, means what the exposure report calls public (services/exposure/sources-places.ts
 *   appSource): anyone may open it AND anyone finds it. That is three facts together: listed (not
 *   community, not unlisted), no access code, and `open_to` anyone (services/app-access.ts). A change is
 *   a raise when the app was not public before it and is public after it. So listing an app that keeps
 *   its code, or dropping the code of an unlisted app, is not a raise: the first still shuts out who
 *   lacks the code, the second is still found only by its address.
 *
 *   ON AN ASK a settings door applies the change WITHOUT the one field that would have made the app
 *   public (services/app-settings-gate.ts), and files a request for that field. The applier
 *   (publish-requests/apply-app.ts) later makes that one change as the owner, through the same
 *   settings function the PATCH uses.
 *
 *   A FIRST PUBLISH (and a fork, which is the first publish of a new app) takes the node's new-app
 *   defaults (services/app-publish-exposure.ts). When those make the app public and the caller is asked
 *   about, the app is published unlisted (still opened by its address when the default is anyone) and
 *   the request is to list it. A republish carries what the owner chose and asks nothing.
 * @structure appIsPublic · appAudienceOf · AppPublishChange · gateFirstPublishExposure · capFirstPublishExposure · AppPublishAsked · askedOf ·
 *   PageGate · publishAskedFields · askedStatus · appAskedNote · fileAppPublishAsk · publishAskFromMeta
 * @usage
 *   const gated = gateFirstPublishExposure(publishExposure(config, live, code), !live, input.publishGate);
 *   ... store with gated.exposure ...; if (gated.asked) asked = await fileAppPublishAsk(ctx, app, gated.asked);
 *   res.status(askedStatus(asked, 201)).json(success(nodeId, { ...publishAskedFields(asked), ... }));
 * @version-history
 *   v1.1.0 — 2026-10-18 — appAudienceOf(): the level an app's facts give, for its label's audience cap;
 *     capFirstPublishExposure(): a first publish's defaults narrowed to that cap (plan
 *     doc-mvdipuyqraas, L3.5).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: apps).
 */
import type { AppListing } from '../storage/interface.js';
import { appListingOf } from '../storage/interface.js';
import { appAccessOf } from './app-access.js';
import { generateAccessCode, type PublishExposure } from './app-publish-exposure.js';
import { fileAsk, publishRequestedBody, type PublishAsk } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import type { AudienceLevel } from './classification/audience-levels.js';
import { audienceCapOf } from './classification/audience-cap.js';
import { appTarget } from './classification/containers.js';

/** The facts that decide whether anyone opens and finds an app. */
export interface AppExposureFacts {
  accessCode?: string | null;
  access?: string | null;
  parked?: boolean;
  community?: boolean;
}

/** Listed, no access code, open to anyone: the exposure report's `public` for an app. */
export function appIsPublic(app: AppExposureFacts): boolean {
  return !app.accessCode
    && appAccessOf({ access: app.access ?? undefined }) === 'anyone'
    && appListingOf({ parked: !!app.parked, community: !!app.community }) === 'listed';
}

/**
 * Who reads an app, as the exposure report counts it (services/exposure/sources-places.ts appSource):
 * private behind an access code, the level `open_to` names when it is not anyone, and otherwise public
 * when it is listed and link when it is found only by its address. The level its label's audience cap
 * is held against (plan doc-mvdipuyqraas, L3.5).
 */
export function appAudienceOf(app: AppExposureFacts): AudienceLevel {
  if (app.accessCode) return 'private';
  const own = appAccessOf({ access: app.access ?? undefined });
  if (own === 'signed-in') return 'signed-in';
  if (own !== 'anyone') return 'organism';
  return appListingOf({ parked: !!app.parked, community: !!app.community }) === 'listed' ? 'public' : 'link';
}

/** The one field a publish request about an app changes. `access_code: 'set'` never names the code. */
export type AppPublishChange =
  | { field: 'listing'; from: AppListing; to: 'listed' }
  | { field: 'open_to'; from: string; to: 'anyone' }
  | { field: 'access_code'; from: 'set'; to: null };

/**
 * The exposure of a first publish, after the gate: unchanged when the node's defaults do not make the
 * app public or the caller may publish; unlisted with a listing request to file when the owner is
 * asked; a refusal when there is nobody here to ask. A republish (`isFirst` false) is never gated.
 */
export function gateFirstPublishExposure(
  exposure: PublishExposure, isFirst: boolean, ask: PublishAsk | null,
): { exposure: PublishExposure; asked?: { requester: PublishRequester; change: AppPublishChange } }
  | { refusal: { status: 403; code: string; message: string } } {
  if (!isFirst || !ask || ask.kind === 'allowed' || !appIsPublic(exposure)) return { exposure };
  if (ask.kind === 'refused') return { refusal: { status: ask.status, code: ask.code, message: ask.message } };
  return {
    exposure: { ...exposure, parked: true, community: false },
    asked: { requester: ask.requester, change: { field: 'listing', from: 'unlisted', to: 'listed' } },
  };
}

/**
 * The exposure of a first publish (or a fork), held to the app's label's audience cap (plan
 * doc-mvdipuyqraas, L3.5). A first publish takes the node's new-app defaults, which the caller did not
 * choose, so a default wider than the cap is narrowed to it rather than refused: unlisted for link,
 * open to signed-in accounts for signed-in, and an access code (the node's own default for a code,
 * app-publish-exposure.ts) for organism or private. A republish carries what the owner chose and is
 * not a raise, so it is returned as it came.
 */
export async function capFirstPublishExposure(
  ctx: PublishStoreCtx, owner: string, filename: string, exposure: PublishExposure, isFirst: boolean,
): Promise<PublishExposure> {
  if (!isFirst) return exposure;
  const answer = await audienceCapOf(ctx, appTarget(owner, filename), appAudienceOf(exposure), { where: 'app first publish' });
  if (answer.kind === 'allowed') return exposure;
  if (answer.cap === 'link') return { ...exposure, parked: true, community: false };
  if (answer.cap === 'signed-in') return { ...exposure, access: 'signed-in' };
  return { ...exposure, accessCode: generateAccessCode() };
}

/** What a door adds to its answer: the filed request, or a warning when it could not be filed. */
export type AppPublishAsked =
  | { publishRequest: ReturnType<typeof publishRequestedBody> }
  | { warning: { code: 'PUBLISH_NOT_ASKED'; message: string } };

/** A filed request (or the refusal to file one) as a door's answer carries it; `stored` says what was kept. */
export function askedOf(
  ctx: PublishStoreCtx, filed: Awaited<ReturnType<typeof fileAsk>>, stored: string,
): AppPublishAsked {
  if (filed.ok) return { publishRequest: publishRequestedBody(ctx, filed) };
  return { warning: { code: 'PUBLISH_NOT_ASKED', message: `${stored}: ${filed.message}` } };
}

/** The gate's answer at a door that switches a page on (services/portfolio-publish-gate.ts, company/company-publish-gate.ts). */
export type PageGate =
  | { kind: 'go' }
  | { kind: 'refused'; status: 403; code: string; message: string }
  | { kind: 'ask'; requester: PublishRequester };

/** What every door's answer carries for it, REST and MCP alike: `publish_request`, or `warnings`. */
export function publishAskedFields(asked: AppPublishAsked | undefined):
  { publish_request?: ReturnType<typeof publishRequestedBody>; warnings?: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string }> } {
  if (!asked) return {};
  return 'publishRequest' in asked ? { publish_request: asked.publishRequest } : { warnings: [asked.warning] };
}

/** 202 when a door's change waits for the owner, else the door's own success status. */
export function askedStatus(asked: AppPublishAsked | undefined, otherwise: number): number {
  return asked && 'publishRequest' in asked ? 202 : otherwise;
}

/** The sentence a door's note carries for a filed request. */
export function appAskedNote(change: AppPublishChange): string {
  const what = change.field === 'listing' ? 'Listing it publicly'
    : change.field === 'open_to' ? 'Opening it to anyone' : 'Removing its access code';
  return `${what} waits for the owner's approval; everything else was applied.`;
}

/**
 * File the request about one app, after the door stored the change it was allowed to make. The
 * target names the app by owner and filename, and `version` is the live version number: a new
 * version published after the request makes its approval outdated.
 */
export async function fileAppPublishAsk(
  ctx: PublishStoreCtx, app: { ownerName: string; filename: string; versionNumber: number },
  asked: { requester: PublishRequester; change: AppPublishChange },
): Promise<AppPublishAsked> {
  return askedOf(ctx, await fileAsk(ctx, app.ownerName, asked.requester, {
    kind: 'app',
    target: { owner: app.ownerName, filename: app.filename, version: app.versionNumber },
    title: `the app ${app.filename}`,
    name: app.filename,
    change: asked.change,
  }), 'The app is not public');
}

/**
 * The gate's answer carried in a presigned upload token (the PUT has no session to ask): read back
 * from the signed meta. Anything that is not one of the three shapes is no answer (null).
 */
export function publishAskFromMeta(value: unknown): PublishAsk | null {
  const v = value as Partial<PublishAsk> & Record<string, unknown> | undefined;
  if (!v || typeof v !== 'object') return null;
  if (v.kind === 'allowed') return { kind: 'allowed' };
  if (v.kind === 'refused' && typeof v.message === 'string' && typeof v.code === 'string') {
    return { kind: 'refused', status: 403, code: v.code, message: v.message };
  }
  const r = (v as { requester?: Partial<PublishRequester> }).requester;
  if (v.kind === 'ask' && r && typeof r.principal === 'string' && typeof r.sub === 'string' && (r.kind === 'agent' || r.kind === 'app')) {
    return { kind: 'ask', requester: { principal: r.principal, kind: r.kind, sub: r.sub } };
  }
  return null;
}
