/**
 * @file src/services/app-news.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person looking at an app can learn about it without leaving it: which version
 *   runs, when it was last updated, what the last versions changed, and, for the people who build it,
 *   that a draft is under way and what it is changing. The app-info mark on the served app
 *   (utils/app-info-badge.ts), GET /v1/apps/:owner/:filename/news and the app's live stream
 *   (routes/sse.ts) all read it here.
 *
 *   WHO SEES THE DRAFT. The owner, the owner's own agents and apps, and every person holding a
 *   development right on the app (services/app-dev-grant.ts, any rung). A visitor never does: "luonnos
 *   ei näy vierailijalle, ainoastaan omistajalle ja mukana oleville" (Jouni, 2026-10-18). A visitor
 *   gets the version and the public roadmap lines, which the app catalogue already shows anyone.
 *
 *   WHAT A VERSION CHANGED is the roadmap's `done` line for it (services/app-roadmap.ts), the line a
 *   publish carries. Nothing new is stored for it here.
 *
 *   HOW A DRAFT NOTICE GOES STALE. A notice is kept with the draft slot, so discarding or promoting
 *   the draft removes it. A draft nobody has saved for DRAFT_STALE_DAYS reads as stale: the news
 *   still carries it, marked, and the app page stops presenting it as work under way.
 * @structure
 *   - DRAFT_NOTICE_MAX / DRAFT_STALE_DAYS
 *   - draftNoticeFrom(raw, by) — a door's `notice` parameter as the record the slot keeps
 *   - appViewerStanding(storage, config, auth, app) — may this caller follow the app, and does it build it
 *   - appStreamTopic(storage, config, auth, "owner/filename") — the topic a live stream ticket carries
 *   - appInfoMarkFor(storage, config, app, locale) — the serve pass's `info` for the app-info mark
 *   - readAppNews(storage, app, builder) — the news itself
 * @usage
 *   const standing = await appViewerStanding(storage, config, req.auth, app);
 *   if (!standing.follow) return 404;
 *   const news = await readAppNews(storage, app, standing.builder);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-p-ivitysmerkki-ja-tietomerkki-sovelluksen-p-lle-merkkien-pii).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord, AppDraftNotice } from '../storage/interface.js';
import { readAppRoadmap } from './app-roadmap.js';
import { equalAppId } from './app-record-keys.js';
import { effectiveDevLevel } from './app-dev-grant.js';
import { appHiddenFromPublicSurfaces } from './app-ai-use.js';
import { appNeedsSignIn, mayOpenApp } from './app-access.js';
import { isNodeAccount, type AudienceAuth } from './audience.js';
import { appInfoMarkOn, appMarksTucked } from '../utils/app-info-badge.js';
import type { Locale } from '../i18n.js';
import { isSameAccount } from '../utils/same-account.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** A notice is one sentence: what the draft changes, in the writer's own words. */
export const DRAFT_NOTICE_MAX = 280;

/** A draft nobody has saved for this long is no longer presented as work under way. */
export const DRAFT_STALE_DAYS = 14;

/** How many of the latest roadmap `done` lines the news carries. */
const CHANGES_SHOWN = 3;

/**
 * A door's `notice` parameter as the record the draft slot keeps.
 *
 * `undefined` (not sent) keeps the slot's notice; `null` or an empty string clears it; a string becomes
 * a notice by `by` at this moment. Too long is refused rather than cut, because a cut sentence says
 * something its writer did not.
 */
export function draftNoticeFrom(
  raw: unknown, by: string, now: Date = new Date(),
): AppDraftNotice | null | undefined | { refusal: string } {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') return { refusal: 'notice must be a string: one sentence on what the draft changes.' };
  const text = raw.trim();
  if (!text) return null;
  if (text.length > DRAFT_NOTICE_MAX) {
    return { refusal: `notice is ${text.length} characters; keep it to one sentence of at most ${DRAFT_NOTICE_MAX}.` };
  }
  return { text, by: localAccountName(by), at: now.toISOString() };
}

/** The fields of an app record the standing reads. */
type AppFacts = Pick<AppRecord, 'ownerName' | 'filename' | 'accessCode' | 'operatorHidden' | 'manifest' | 'access'>;

export interface AppViewerStanding {
  /** May this caller follow the app: read its news and open its live stream. */
  follow: boolean;
  /** Does this caller build it: the owner's account, or a development right of any rung. */
  builder: boolean;
}

/** The token facts the standing reads: an AudienceAuth plus the roles and an app token's own app. */
export type AppViewerAuth = AudienceAuth & { sub?: string; roles?: readonly string[]; app?: string };

/**
 * May this caller follow the app, and do they build it.
 *
 * Following needs no account for an app anyone can open (no access code, no sign-in gate, no pacing
 * amount to take first, no operator hide). A gated app is followed by the people its gate admits, minus
 * an access code, which this cannot check: a code is typed into the page, never carried to the stream.
 * A builder always follows.
 *
 * Building is a person's standing, reached by that person and their own agents. An app token acts in
 * its signed-in person's name too, so it counts only on its OWN app: another app the owner signed
 * into must not read this app's draft. An ecosystem app never builds.
 */
export async function appViewerStanding(
  storage: Storage, config: AimeatConfig, auth: AppViewerAuth | null | undefined, app: AppFacts,
): Promise<AppViewerStanding> {
  let builder = false;
  const roles = auth?.roles ?? [];
  const appId = `${app.ownerName}/${app.filename}`;
  const actsForThisApp = !roles.includes('app') || (typeof auth?.app === 'string' && equalAppId(auth.app, appId));
  if (isNodeAccount(auth) && actsForThisApp && !roles.includes('ecosystem')) {
    const principal = auth!.sub ?? auth!.owner!;
    builder = isSameAccount(localAccountName(principal), app.ownerName)
      || isSameAccount(auth!.owner, app.ownerName)
      || !!(await effectiveDevLevel(storage, { owner: app.ownerName, filename: app.filename, principal }));
  }
  if (builder) return { follow: true, builder };
  if (appHiddenFromPublicSurfaces(config, app)) return { follow: false, builder };
  if (!appNeedsSignIn(config, app)) return { follow: true, builder };
  return { follow: isNodeAccount(auth) && await mayOpenApp(storage, config, app, auth), builder };
}

/** The app a live stream follows: its id, and whether the stream may hear its draft. */
export interface AppStreamTopic {
  id: string;
  builder: boolean;
}

/**
 * The app a stream ticket asks to follow (`"owner/filename"`), as the topic the ticket carries, or
 * null when there is no such app or this caller may not follow it. The two answers are one on
 * purpose: a stream must not tell a stranger that a hidden app exists.
 */
export async function appStreamTopic(
  storage: Storage, config: AimeatConfig, auth: AppViewerAuth | null | undefined, raw: unknown,
): Promise<AppStreamTopic | null> {
  if (typeof raw !== 'string' || raw.length > 300) return null;
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1 || raw.indexOf('/', slash + 1) >= 0) return null;
  const app = await storage.getAppByOwnerName(raw.slice(0, slash), raw.slice(slash + 1));
  if (!app) return null;
  const standing = await appViewerStanding(storage, config, auth, app);
  return standing.follow ? { id: `${app.ownerName}/${app.filename}`, builder: standing.builder } : null;
}

export interface AppNewsChange {
  what: string;
  version?: number;
  at: string;
}

export interface AppDraftNews {
  /** When the draft was last saved. */
  savedAt: string;
  /** What it is changing, when somebody said. */
  notice?: AppDraftNotice;
  /** Nobody has saved it for DRAFT_STALE_DAYS. */
  stale: boolean;
}

export interface AppNews {
  app: string;
  /** The live version number. */
  version: number;
  /** The author's own version label from the manifest, when there is one. */
  label?: string;
  /** When the live version was published. */
  updatedAt: string;
  /** The latest roadmap `done` lines, newest first. */
  changes: AppNewsChange[];
  /** Builders only: the draft under way, or null when there is none. Absent for anyone else. */
  draft?: AppDraftNews | null;
}

/**
 * What the serve pass needs for the app-info mark on one served app (services/app-serve-marks.ts
 * `info`), or undefined when the owner switched the mark off. The served bytes are the same for
 * everyone, so this is the public news: a builder's draft is added on the page by app-news.js.
 */
export async function appInfoMarkFor(
  storage: Storage, config: Pick<AimeatConfig, 'baseUrl'>,
  app: Pick<AppRecord, 'ownerName' | 'ownerGaii' | 'filename' | 'versionNumber' | 'createdAt' | 'manifest'>,
  locale: Locale,
): Promise<{ news: AppNews; tucked: boolean; moreUrl: string; locale: Locale } | undefined> {
  if (!appInfoMarkOn(app.manifest)) return undefined;
  const news = await readAppNews(storage, app, false);
  // The catalogue opens this app's details in the view it belongs to (public/views/appcat.js ?app=).
  const moreUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/appcat?app=${encodeURIComponent(`${app.ownerName}/${app.filename}`)}`;
  return { news, tucked: appMarksTucked(app.manifest), moreUrl, locale };
}

/**
 * The news of one app as `builder` may see it. The roadmap and the draft are read best-effort: the
 * version alone is still news, and the app page must not fail over a record beside it.
 */
export async function readAppNews(
  storage: Storage, app: Pick<AppRecord, 'ownerName' | 'ownerGaii' | 'filename' | 'versionNumber' | 'createdAt' | 'manifest'>,
  builder: boolean, now: Date = new Date(),
): Promise<AppNews> {
  const appId = `${app.ownerName}/${app.filename}`;
  const road = await readAppRoadmap(storage, appId).catch((err) => {
    logger.warn('readAppNews: the roadmap was not read; the news carries no changes', { appId, error: String(err) });
    return null;
  });
  const changes = (road?.entries ?? [])
    .filter(e => e.state === 'done')
    .slice(0, CHANGES_SHOWN)
    .map(e => ({ what: e.what, ...(e.version ? { version: e.version } : {}), at: e.at }));
  const news: AppNews = {
    app: appId,
    version: app.versionNumber,
    ...(app.manifest.version ? { label: app.manifest.version } : {}),
    updatedAt: app.createdAt,
    changes,
  };
  if (builder) {
    const draft = await storage.getAppDraft(app.ownerGaii, app.filename).catch((err) => {
      logger.warn('readAppNews: the draft slot was not read; the news says there is no draft', { appId, error: String(err) });
      return null;
    });
    news.draft = draft ? {
      savedAt: draft.updatedAt,
      ...(draft.manifest.draftNotice ? { notice: draft.manifest.draftNotice } : {}),
      stale: now.getTime() - Date.parse(draft.updatedAt) > DRAFT_STALE_DAYS * 864e5,
    } : null;
  }
  return news;
}
