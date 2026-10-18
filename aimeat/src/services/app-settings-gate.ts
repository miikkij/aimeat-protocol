/**
 * @file src/services/app-settings-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate on an app's settings (plan doc-mvcn6c7e4e5q, V4): PATCH /v1/apps/:filename
 *   and aimeat_app_manage action "settings". A change that makes the app public (listed, no access
 *   code, open to anyone: services/app-publish-gate.ts appIsPublic), by a caller the node asks the
 *   owner about, is applied WITHOUT the one field that would have made it public, and a request for
 *   that field is filed: listing first, then `open_to`, then the access code. Holding back one field
 *   is enough, because public needs all three.
 *
 *   Its own file, apart from app-publish-gate.ts, because it reads app-settings.ts, which reaches
 *   app-lifecycle.ts, which asks the first-publish gate: one file for both is an import cycle.
 * @structure AppSettingsGate · appSettingsGate · appSettingsCapRefusal · applyOwnerSettingsGated
 * @usage
 *   const capped = await appSettingsCapRefusal(ctx, caller, app, body);   // 409 first
 *   const gate = appSettingsGate({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app, app, body);
 *   if (gate.kind === 'refused') → 403; else apply gate.body; if (gate.kind === 'ask') fileAppPublishAsk(...)
 * @version-history
 *   v1.1.0 — 2026-10-18 — appSettingsCapRefusal(): a settings change that would give the app a level
 *     wider than its label allows is refused with 409 LABEL_CAPS_AUDIENCE (plan doc-mvdipuyqraas, L3.5).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: apps).
 */
import type { AppRecord } from '../storage/interface.js';
import { appListingOf } from '../storage/interface.js';
import { appAccessOf } from './app-access.js';
import {
  parseOwnerSettingsInput, applyOwnerSettingsUpdate, SETTINGS_FIELDS, type AppSettingsInput, type AppSettingsTarget,
} from './app-settings.js';
import {
  appIsPublic, appAudienceOf, appAskedNote, fileAppPublishAsk, type AppExposureFacts, type AppPublishAsked, type AppPublishChange,
} from './app-publish-gate.js';
import { audienceCapOf, capByOf, capRefusalOf } from './classification/audience-cap.js';
import { appTarget } from './classification/containers.js';
import type { CallerContext } from './caller-context.js';
import { publishAskOf } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';

/** The settings body keys each change holds back: `parked` is the older word for the listing. */
const HELD_KEYS: Record<AppPublishChange['field'], readonly string[]> = {
  listing: ['listing', 'parked'],
  open_to: ['open_to'],
  access_code: ['access_code'],
};

export type AppSettingsGate =
  | { kind: 'go'; body: AppSettingsInput }
  | { kind: 'refused'; status: 403; code: string; message: string }
  /** `body` is the settings body without the field the request is about. */
  | { kind: 'ask'; body: AppSettingsInput; requester: PublishRequester; change: AppPublishChange };

/**
 * Before the first write of a settings change: does it make the app public, and may this caller do
 * that on its own? A body the settings parser refuses goes on unchanged: its own refusal answers it.
 */
export function appSettingsGate(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined,
  app: AppRecord, body: AppSettingsInput,
): AppSettingsGate {
  const parsed = parseOwnerSettingsInput(body as Record<string, unknown>);
  if ('refusal' in parsed) return { kind: 'go', body };
  const s = parsed.settings;
  const listingNow = appListingOf(app);
  const listingAfter = s.listing ?? listingNow;
  const after: AppExposureFacts = {
    accessCode: s.accessCode ? s.accessCode.code : app.accessCode,
    access: s.access ? s.access.store : app.access,
    parked: listingAfter !== 'listed',
    community: listingAfter === 'community',
  };
  if (appIsPublic(app) || !appIsPublic(after)) return { kind: 'go', body };
  const ask = publishAskOf(ctx, caller, appGrant);
  if (ask.kind === 'allowed') return { kind: 'go', body };
  if (ask.kind === 'refused') return ask;
  const openNow = appAccessOf(app);
  const change: AppPublishChange = listingNow !== 'listed'
    ? { field: 'listing', from: listingNow, to: 'listed' }
    : openNow !== 'anyone'
      ? { field: 'open_to', from: openNow, to: 'anyone' }
      : { field: 'access_code', from: 'set', to: null };
  const held = HELD_KEYS[change.field];
  const rest = Object.fromEntries(Object.entries(body).filter(([k]) => !held.includes(k))) as AppSettingsInput;
  return { kind: 'ask', body: rest, requester: ask.requester, change };
}

/**
 * The app's label caps the level a settings change gives it (plan doc-mvdipuyqraas, L3.5): null, or
 * the 409 to answer. Asked before appSettingsGate and before the first write, by every door that
 * changes an app's settings. A body the settings parser refuses goes on to its own refusal.
 */
export async function appSettingsCapRefusal(
  ctx: PublishStoreCtx, caller: CallerContext, app: AppRecord, body: AppSettingsInput,
): Promise<{ ok: false; status: 409; code: string; message: string } | null> {
  const parsed = parseOwnerSettingsInput(body as Record<string, unknown>);
  if ('refusal' in parsed) return null;
  const s = parsed.settings;
  const listingAfter = s.listing ?? appListingOf(app);
  const after = appAudienceOf({
    accessCode: s.accessCode ? s.accessCode.code : app.accessCode,
    access: s.access ? s.access.store : app.access,
    parked: listingAfter !== 'listed',
    community: listingAfter === 'community',
  });
  return capRefusalOf(await audienceCapOf(ctx, appTarget(app.ownerGaii, app.filename), after, {
    from: appAudienceOf(app), by: capByOf(caller), where: 'app settings',
  }));
}

/**
 * The settings write through the gate, for a door that writes nothing but settings (aimeat_app_manage
 * action "settings"): the gate, applyOwnerSettingsUpdate with the rest of the change, then the
 * request. PATCH /v1/apps/:filename asks appSettingsGate itself, because it writes other fields too.
 */
export async function applyOwnerSettingsGated(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined,
  target: AppSettingsTarget, body: AppSettingsInput,
): Promise<{ notes: string[]; asked?: AppPublishAsked } | { refusal: { status: number; code: string; message: string } }> {
  const app = await ctx.storage.getApp(target.ownerGaii, target.filename);
  const capped = app ? await appSettingsCapRefusal(ctx, caller, app, body) : null;
  if (capped) return { refusal: capped };
  const gate = app ? appSettingsGate(ctx, caller, appGrant, app, body) : { kind: 'go' as const, body };
  if (gate.kind === 'refused') return { refusal: gate };
  const rest = gate.body as Record<string, unknown>;
  const out = gate.kind === 'ask' && !SETTINGS_FIELDS.some(f => f in rest)
    ? { notes: [] as string[] }
    : await applyOwnerSettingsUpdate(ctx.storage, ctx.config, target, gate.body);
  if ('refusal' in out) return out;
  if (gate.kind !== 'ask' || !app) return out;
  return { notes: [...out.notes, appAskedNote(gate.change)], asked: await fileAppPublishAsk(ctx, app, gate) };
}
