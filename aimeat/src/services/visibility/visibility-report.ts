/**
 * @file src/services/visibility/visibility-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one AI visibility report: where people came from, which AIs fetched what, who
 *   read the place's discovery files, and which purchases followed. The owner's panel shows it, and
 *   the MCP tool returns the same object, so the owner's own AI can ask "why did sales drop" and get
 *   the numbers the screen shows.
 *
 *   THE READING TRAVELS WITH THE NUMBERS. Each part carries one sentence that says what the number
 *   is worth, and the report says plainly what it cannot see: the question a person asked the AI.
 *   Only whoever runs the AI sees that. What this report shows instead is which pages and tools the
 *   AI fetched, when, on whose behalf, and what followed.
 * @structure clampVisibilityDays · readVisibilityReport · VisibilityReport
 * @usage const report = await readVisibilityReport(storage, config, ownerGhii, { days: 30 });
 * @version-history
 *   v1.1.0 — 2026-10-08 — `tags`: the owner's own Clarity and GA4 on the place's pages (layer B).
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  VISIBILITY_DAYS_DEFAULT, VISIBILITY_DAYS_MAX, VISIBILITY_MONTH_PREFIX, VISIT_CHANNELS,
  emptyVisibilityDay, type VisibilityDay, type VisibilityMonthRecord, type VisitChannel,
} from '../../models/visibility-schemas.js';
import { monthOf } from '../../models/signal-schemas.js';
import { flushVisibility, mergeDay, nodeCountsVisibility, sumOf } from './visibility-counter.js';
import { getVisibilitySettings } from './visibility-settings.js';
import { visibilitySettingsView } from './analytics-tags.js';

/** 0 is "today only". Anything that is not a whole number in range is the default. */
export function clampVisibilityDays(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : (typeof raw === 'number' ? raw : NaN);
  if (!Number.isInteger(n) || n < 0) return VISIBILITY_DAYS_DEFAULT;
  return Math.min(n, VISIBILITY_DAYS_MAX);
}

export interface PurchaseRow {
  channel: string;
  /** The AI family, when the channel is `ai`. */
  family: string | null;
  /** `page`: a person bought on a page. `agent`: an agent bought through a checkout endpoint. */
  via: string;
  purchases: number;
  /** Per currency, in 6-decimal micro-units for money and whole morsels for `MORSEL`. */
  amounts: Record<string, number>;
}

export interface VisibilityReport {
  /** Whether counting runs now: the owner's switch and the operator's, both. */
  counting: boolean;
  owner_enabled: boolean;
  node_enabled: boolean;
  days: number;
  from: string;
  to: string;
  totals: {
    /** Every counted request, the opted-out ones included. */
    requests: number;
    people: number;
    assistant_fetches: number;
    crawler_fetches: number;
    other_machines: number;
    /** Requests that asked not to be followed (Sec-GPC or DNT), counted here and nowhere else. */
    opted_out: number;
    purchases: number;
    ai_referred_purchases: number;
  };
  /** People by where they came from. */
  channels: Record<VisitChannel, number>;
  /** People who came from an AI's answer, by AI, largest first. */
  ai_referrals: Array<{ family: string; people: number }>;
  assistant_fetches: Array<{ family: string; fetches: number }>;
  crawler_fetches: Array<{ family: string; fetches: number }>;
  /** The targets AIs fetched most, with people beside them. At most 25. */
  top_paths: Array<{ target: string; people: number; assistant: Record<string, number>; crawler: Record<string, number> }>;
  /** Fetches of a target the per-day table had no room for. */
  paths_other: number;
  /** Who read the machine-readable files. */
  discovery: Array<{ doc: string; fetches: number; by: Record<string, number> }>;
  purchases: PurchaseRow[];
  /** One row per day that had a count, oldest first. */
  series: Array<{
    day: string; people: number; ai_people: number; assistant: number; crawler: number;
    purchases: number; channels: Partial<Record<VisitChannel, number>>;
  }>;
  /** The owner's own analytics tags on the place's pages (layer B), and whether they wait for consent. */
  tags: {
    clarity_project_id: string | null;
    ga4_measurement_id: string | null;
    active: boolean;
    consent_banner: boolean;
    /** Set when a tag loads with no banner: the owner must hear that EU visitors need consent. */
    warning: string | null;
  };
  reading: Record<'channels' | 'assistant' | 'crawler' | 'discovery' | 'purchases' | 'not_seen' | 'opted_out' | 'privacy', string>;
}

const dayStr = (d: Date): string => d.toISOString().slice(0, 10);

const ranked = <K extends string>(o: Record<string, number>, key: K): Array<Record<K, string> & Record<string, number | string>> =>
  Object.entries(o).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ [key]: name, n }) as unknown as Record<K, string> & Record<string, number | string>);

export async function readVisibilityReport(
  storage: Storage, config: AimeatConfig, ownerGhii: string, opts: { days?: unknown } = {},
): Promise<VisibilityReport> {
  // What this process counted and has not merged yet belongs in the answer.
  await flushVisibility(storage, ownerGhii);

  const days = clampVisibilityDays(opts.days);
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - days * 86_400_000);
  const from = dayStr(fromDate);
  const to = dayStr(toDate);
  const fromMonth = monthOf(from);
  const toMonth = monthOf(to);

  const rows = await storage.listMemory(ownerGhii, { prefix: VISIBILITY_MONTH_PREFIX });
  const months = rows
    .map((r) => r.value as unknown as VisibilityMonthRecord)
    .filter((m): m is VisibilityMonthRecord => !!m && typeof m.month === 'string')
    .filter((m) => m.month >= fromMonth && m.month <= toMonth);

  const sum = emptyVisibilityDay();
  const series: VisibilityReport['series'] = [];
  for (const m of months) {
    for (const [day, raw] of Object.entries(m.days ?? {})) {
      if (day < from || day > to) continue;
      const d = { ...emptyVisibilityDay(), ...raw } as VisibilityDay;
      mergeDay(sum, d, Infinity);
      let purchases = 0;
      for (const p of Object.values(d.purchases)) purchases += p.n;
      series.push({
        day,
        people: d.classes.human ?? 0,
        ai_people: sumOf(d.aiReferrals),
        assistant: sumOf(d.assistant),
        crawler: sumOf(d.crawler),
        purchases,
        channels: { ...d.channels },
      });
    }
  }
  series.sort((a, b) => a.day.localeCompare(b.day));

  const channels = Object.fromEntries(VISIT_CHANNELS.map((c) => [c, sum.channels[c] ?? 0])) as Record<VisitChannel, number>;

  const purchases: PurchaseRow[] = Object.entries(sum.purchases).map(([key, p]) => {
    const [channel = 'direct', family = '', via = 'page'] = key.split('|');
    return { channel, family: family || null, via, purchases: p.n, amounts: { ...p.amounts } };
  }).sort((a, b) => b.purchases - a.purchases);

  const topPaths = Object.entries(sum.paths)
    .map(([target, c]) => ({ target, people: c.h, assistant: { ...c.a }, crawler: { ...c.c }, ai: sumOf(c.a) + sumOf(c.c) }))
    .sort((a, b) => (b.ai - a.ai) || (b.people - a.people))
    .slice(0, 25)
    .map(({ ai: _ai, ...rest }) => rest);

  const settings = await getVisibilitySettings(storage, ownerGhii);
  const nodeEnabled = nodeCountsVisibility(config);
  const view = visibilitySettingsView(config, settings);

  return {
    counting: settings.enabled && nodeEnabled,
    owner_enabled: settings.enabled,
    node_enabled: nodeEnabled,
    days, from, to,
    totals: {
      requests: sum.total,
      people: sum.classes.human ?? 0,
      assistant_fetches: sumOf(sum.assistant),
      crawler_fetches: sumOf(sum.crawler),
      other_machines: sum.classes.bot ?? 0,
      opted_out: sum.optedOut,
      purchases: purchases.reduce((n, p) => n + p.purchases, 0),
      ai_referred_purchases: purchases.filter((p) => p.channel === 'ai').reduce((n, p) => n + p.purchases, 0),
    },
    channels,
    ai_referrals: ranked(sum.aiReferrals, 'family').map((r) => ({ family: r.family, people: r.n as number })),
    assistant_fetches: ranked(sum.assistant, 'family').map((r) => ({ family: r.family, fetches: r.n as number })),
    crawler_fetches: ranked(sum.crawler, 'family').map((r) => ({ family: r.family, fetches: r.n as number })),
    top_paths: topPaths,
    paths_other: sum.pathsOther,
    discovery: Object.entries(sum.discovery)
      .map(([doc, by]) => ({ doc, fetches: sumOf(by), by: { ...by } }))
      .sort((a, b) => b.fetches - a.fetches),
    purchases,
    series,
    tags: {
      clarity_project_id: settings.clarityProjectId,
      ga4_measurement_id: settings.ga4MeasurementId,
      active: view.tags_active === true,
      consent_banner: view.consent_banner === true,
      warning: (view.tags_warning as string | null) ?? null,
    },
    reading: {
      channels: 'People only, by the page that sent them: an AI answer, a search engine, a social network, another site, or nothing (a typed address, a bookmark, an app that hides where it came from). Internal is a move between your own pages.',
      assistant: 'A person asked an AI something and it fetched this page to answer. Each one is a moment your business was part of an AI answer.',
      crawler: 'An AI built its index or its training data. Nobody was waiting; this is how an AI comes to know you exist.',
      discovery: 'Fetches of the files an AI or an agent reads to learn how to use your place: llms.txt, AGENTS.md, the MCP server card and the UCP profile.',
      purchases: 'Completed purchases by where the buyer came from. "page" is a person who bought on your page; "agent" is an AI that bought through your checkout for someone. "none" is a purchase whose buyer asked not to be followed, or that nothing could place.',
      not_seen: 'The questions people asked the AI are not visible here. Only whoever runs the AI sees them. This report shows which pages and tools the AI fetched, when, on whose behalf, and what followed.',
      opted_out: 'Visitors whose browser asks not to be followed (Global Privacy Control or Do Not Track) are in the request total only.',
      privacy: 'No address, no cookie and no visitor id is kept. Each visit is a count under a channel and an AI name, nothing more.',
    },
  };
}
