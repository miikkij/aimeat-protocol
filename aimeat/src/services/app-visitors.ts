/**
 * @file src/services/app-visitors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who opened one of my apps, when, and from where: one answer an app's author can ask
 *   for in chat or read in the App Catalog, composed from the two places the node already counts.
 *
 *   TWO SOURCES, AND WHY THEY ARE NOT ONE. Every open of an app lands in the usage call stream
 *   (services/usage/record-app-open.ts) whether or not anybody asked, and it knows ONE thing about
 *   the visitor: whether somebody was signed in. What KIND of visitor it was, a person, a named AI
 *   or a crawler, and where a person came from, is only kept once the author opts the page in by
 *   creating its signal stream (services/signals/page-views.ts). So the first half of this report
 *   is always there, and the second half is null until measurement is on. The report says which
 *   state it is in rather than answering zeros that read as "nobody came".
 *
 *   COUNTS, NEVER IDENTITIES. The usage cut behind the signed-in split is keyed by the visitor's
 *   GHII, because that is what makes "how many different people" answerable. This file reads those
 *   rows and hands out a number. An author learns that four signed-in people opened the app and
 *   never which four: visiting somebody's app is not consent to be named to them.
 *
 *   THE STREAM ID IS A CONVENTION OWNED IN ONE PLACE. `pageStreamId(filename)` decides it, the serve
 *   path counts into it, and this file is the door that creates it, so no client ever has to
 *   re-derive the slug rule to switch measurement on.
 * @structure
 *   - VISITOR_DAYS_MAX / clampDays
 *   - readAppVisitors(storage, args)        -- the report
 *   - setAppMeasurement(storage, args)      -- the switch, and the precision a place is kept at
 * @usage
 *   const report = await readAppVisitors(storage, { app, days: 30, geoAvailable: config.geoHeaders });
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: the Visitors section of the App Catalog and its two MCP tools.
 */
import type { Storage, AppRecord } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { queryUsageRollupLive, usageComputedThrough, dayNDaysAgo } from './usage/usage-read.js';
import { pageStreamId } from './signals/page-views.js';
import { getStream, saveStream, readReport, type SignalReport } from './signals/signal-service.js';
import { UNKNOWN_COUNTRY, type SignalGeoLevel } from '../models/signal-schemas.js';

/** The widest window a report answers. The day rollups are kept longer; a year is what a chart reads. */
export const VISITOR_DAYS_MAX = 360;
export const VISITOR_DAYS_DEFAULT = 30;

/** 0 is a value: "today only". Anything that is not a whole number in range is the default. */
export function clampDays(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
  if (!Number.isInteger(n) || n < 0) return VISITOR_DAYS_DEFAULT;
  return Math.min(n, VISITOR_DAYS_MAX);
}

export interface AppVisitorsReport {
  /** `owner/filename`, the app id everywhere else on the node. */
  app: string;
  days: number;
  from: string;
  to: string;
  opens: {
    /** Opens inside the window. */
    total: number;
    signed_in: number;
    anonymous: number;
    /** How many DIFFERENT signed-in people. A number, never a list. */
    signed_in_people: number;
    /** Every open since the app was published, from the catalogue's lifetime counter. */
    lifetime: number;
    /** One entry per day that had an open, oldest first. */
    series: Array<{ day: string; signed_in: number; anonymous: number }>;
    /** Opens after this instant may not be in the numbers yet. Null before the first fold. */
    computed_through: string | null;
  };
  measurement: {
    on: boolean;
    stream_id: string;
    /** The precision a person's place is kept at. `off` until the author picks one. */
    geo: SignalGeoLevel;
    /** False when this node is not told where a request came from, so a map would stay empty. */
    geo_available: boolean;
    /** The credit the operator's address database asks for. Empty when there is none to show. */
    geo_attribution: string;
  };
  /** Null until measurement is on. */
  visitors: null | {
    total: number;
    humans: number;
    ai: number;
    bots: number;
    /** Named AIs, most frequent first. `asked` is a person's assistant fetching the page to answer
     *  them; `crawled` is an index or a training corpus being built. */
    ai_agents: Array<{ name: string; asked: number; crawled: number }>;
    series: Array<{ day: string; humans: number; ai: number; bots: number }>;
    /** People by ISO 3166-1 alpha-2 country. `ZZ` is a visit whose place could not be told. */
    countries: Array<{ country: string; people: number }>;
    /** People by region or city, when the author chose that precision. */
    places: Array<{ country: string; region: string; city: string | null; lat: number | null; lon: number | null; people: number }>;
    places_truncated: boolean;
    unknown_country: string;
    reading: SignalReport['reading'];
  };
}

/** Thrown for the two things a caller can get wrong; the route and the MCP tool map them to 404/400. */
export class AppVisitorsError extends Error {
  constructor(public code: 'APP_NOT_FOUND' | 'INVALID_INPUT', public statusCode: number, message: string) {
    super(message);
    this.name = 'AppVisitorsError';
  }
}

export interface AppRef {
  /** Bare owner name, the first half of the app id. */
  owner: string;
  filename: string;
}

/** `owner/filename` → its two halves, or null when it is not that shape. */
export function parseAppId(appId: string): AppRef | null {
  const slash = appId.indexOf('/');
  if (slash <= 0 || slash === appId.length - 1) return null;
  const owner = appId.slice(0, slash);
  return { owner: owner.includes('@') ? owner.split('@')[0] : owner, filename: appId.slice(slash + 1) };
}

async function loadApp(storage: Storage, ref: AppRef): Promise<AppRecord> {
  const app = await storage.getAppByOwnerName(ref.owner, ref.filename);
  if (!app) throw new AppVisitorsError('APP_NOT_FOUND', 404, 'No such published app');
  return app;
}

export async function readAppVisitors(storage: Storage, args: {
  app: AppRef;
  days: number;
  /** Whether this node is told where a request came from (config.geoHeaders). */
  geoAvailable: boolean;
  /** config.geoAttribution. */
  geoAttribution?: string;
}): Promise<AppVisitorsReport> {
  const app = await loadApp(storage, args.app);
  const ownerGhii = ownerGhiiOf(app.ownerGaii);
  const appId = `${args.app.owner}/${args.app.filename}`;
  const from = dayNDaysAgo(args.days);
  const to = dayNDaysAgo(0);

  // ── Opens: always there ─────────────────────────────────────────────────────────────────────
  // No ownerGhii pin on purpose: this cut is keyed by the VISITOR, and the question is about every
  // visitor of one app. What makes that safe is above this call (the route proved the caller owns
  // the app) and below it (only counts leave this function).
  const rows = await queryUsageRollupLive(storage, {
    cut: 'call.app.visitor', grain: 'day', from, to, appId, limit: 50_000,
  }, 'call');

  const byDay = new Map<string, { signed_in: number; anonymous: number }>();
  const people = new Set<string>();
  let signedIn = 0;
  let anonymous = 0;
  for (const r of rows) {
    if (r.surface !== 'app') continue;
    const day = byDay.get(r.bucket) ?? { signed_in: 0, anonymous: 0 };
    if (r.ownerGhii) { day.signed_in += r.calls; signedIn += r.calls; people.add(r.ownerGhii); }
    else { day.anonymous += r.calls; anonymous += r.calls; }
    byDay.set(r.bucket, day);
  }

  const [lifetime, computedThrough] = await Promise.all([
    storage.getAppDownloads(app.ownerGaii, app.filename),
    usageComputedThrough(storage),
  ]);

  // ── Measurement: only once the author asked ─────────────────────────────────────────────────
  const streamId = pageStreamId(app.filename);
  const stream = await getStream(storage, ownerGhii, streamId);
  const on = !!stream && stream.enabled;

  let visitors: AppVisitorsReport['visitors'] = null;
  if (stream) {
    const rep = await readReport(storage, ownerGhii, streamId, { fromDay: from, toDay: to });
    const agents = new Map<string, { asked: number; crawled: number }>();
    for (const [key, n] of Object.entries(rep.totals.aiAgents)) {
      const asked = key.endsWith(':asked');
      const name = asked ? key.slice(0, -':asked'.length) : key;
      const entry = agents.get(name) ?? { asked: 0, crawled: 0 };
      if (asked) entry.asked += n; else entry.crawled += n;
      agents.set(name, entry);
    }
    visitors = {
      total: rep.totals.hits,
      humans: rep.totals.classes.human ?? 0,
      ai: rep.totals.classes.ai ?? 0,
      bots: rep.totals.classes.bot ?? 0,
      ai_agents: [...agents.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => (b.asked + b.crawled) - (a.asked + a.crawled)),
      series: Object.entries(rep.days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, c]) => ({ day, humans: c.classes.human ?? 0, ai: c.classes.ai ?? 0, bots: c.classes.bot ?? 0 })),
      countries: Object.entries(rep.totals.countries)
        .map(([country, n]) => ({ country, people: n }))
        .sort((a, b) => b.people - a.people),
      places: Object.entries(rep.totals.places)
        .map(([key, n]) => ({ place: rep.places[key], people: n }))
        .filter((p) => !!p.place)
        .map((p) => ({ ...p.place, people: p.people }))
        .sort((a, b) => b.people - a.people),
      places_truncated: rep.placesTruncated,
      unknown_country: UNKNOWN_COUNTRY,
      reading: rep.reading,
    };
  }

  return {
    app: appId, days: args.days, from, to,
    opens: {
      total: signedIn + anonymous, signed_in: signedIn, anonymous,
      signed_in_people: people.size, lifetime,
      series: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
      computed_through: computedThrough,
    },
    measurement: {
      on, stream_id: streamId, geo: stream?.geo ?? 'off',
      geo_available: args.geoAvailable, geo_attribution: args.geoAttribution ?? '',
    },
    visitors,
  };
}

/**
 * Switch measurement on or off for one app, and set how precisely a place is kept.
 *
 * Off DISABLES the stream and keeps what it collected: an author who turns it off to think about
 * it must not lose a year of counts to do so. Deleting the stream is the signals door's job
 * (DELETE /v1/signals/streams/:id), which says in its own words that the months go with it.
 */
export async function setAppMeasurement(storage: Storage, args: {
  app: AppRef;
  on: boolean;
  geo?: string;
}): Promise<{ stream_id: string; on: boolean; geo: SignalGeoLevel }> {
  const app = await loadApp(storage, args.app);
  const ownerGhii = ownerGhiiOf(app.ownerGaii);
  const streamId = pageStreamId(app.filename);
  const existing = await getStream(storage, ownerGhii, streamId);

  // Turning off something that was never on writes nothing: no stream is created just to be disabled.
  if (!args.on && !existing) return { stream_id: streamId, on: false, geo: 'off' };

  const cfg = await saveStream(storage, ownerGhii, {
    streamId,
    label: existing?.label ?? (app.manifest?.name || app.filename),
    channel: 'page',
    // Visitors of a page carry no sender-minted subject, so there is nothing to roll up per subject.
    perSubject: false,
    group: existing?.group ?? `app:${args.app.owner}/${args.app.filename}`,
    enabled: args.on,
    geo: args.geo,
  });
  return { stream_id: streamId, on: cfg.enabled, geo: cfg.geo ?? 'off' };
}
