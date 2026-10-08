/**
 * @file src/models/visibility-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record AI visibility is counted into: one per owner per calendar month, in the
 *   owner's own namespace, holding nothing but counts.
 *
 *   WHAT IS NOT IN IT, by design: no IP address, no cookie, no visitor id, no Referer, no query
 *   string, no User-Agent. A page load becomes a channel from a closed list, an AI family from a
 *   closed table and a target the owner published (an app's filename, a fixed discovery file). That
 *   is why counting runs by default with no consent banner: there is nothing in the record that
 *   could single out a person.
 *
 *   ONE KEY PER MONTH, so a year of counting costs twelve keys of the owner's key budget however
 *   many apps they publish (CLAUDE.md, a memory value is a record). The per-day path table is
 *   capped, which keeps a busy month inside the value ceiling: 31 days of 50 paths is under 300 kB.
 *
 *   `signals.` is a reserved owner prefix (utils/reserved-keys.ts), so nobody can write a forged
 *   count through the memory API. Only the counter in services/visibility/ writes these keys.
 * @structure caps · keys · VisibilityDay · VisibilityMonthRecord · VisibilitySettings · emptyVisibilityDay
 * @usage import { visibilityMonthKey, type VisibilityMonthRecord } from '../models/visibility-schemas.js';
 * @version-history
 *   v1.1.0 — 2026-10-08 — VisibilitySettings carries the owner's Clarity and GA4 ids (layer B).
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
/** Where a person came from. A closed list, so every record ever written reads the same way.
 *  `internal` is a move between pages of the same place, which is not an arrival. */
export const VISIT_CHANNELS = ['ai', 'search', 'social', 'referral', 'direct', 'internal'] as const;
export type VisitChannel = (typeof VISIT_CHANNELS)[number];

/**
 * The AI families a report can name. The fetcher table in signals/visitor-class.ts uses the same
 * short names, so "ChatGPT fetched the page" and "a person came from ChatGPT" land under one key.
 * `other` is an AI this table does not know yet.
 */
export const AI_FAMILIES = [
  'chatgpt', 'claude', 'perplexity', 'copilot', 'gemini', 'meta-ai', 'mistral', 'grok', 'deepseek',
  'you', 'poe', 'phind', 'duckassist', 'other',
] as const;
export type AiFamily = (typeof AI_FAMILIES)[number];

/**
 * The machine-readable files an AI or an agent reads to understand a place. A fetch of one of them
 * is the nearest thing to "an AI found this place and read how to use it", so they are counted on
 * their own, by who fetched them.
 */
export const VISIBILITY_DOCS = ['llms.txt', 'llms-full.txt', 'AGENTS.md', 'mcp.json', 'ucp'] as const;
export type VisibilityDoc = (typeof VISIBILITY_DOCS)[number];

/** How a purchase was made: a person on a page, or an agent through a checkout endpoint. */
export const PURCHASE_VIA = ['page', 'agent'] as const;
export type PurchaseVia = (typeof PURCHASE_VIA)[number];

// ── Caps ──────────────────────────────────────────────────────────────────────────────────────

/** Distinct targets kept per day. Past it a fetch still counts in every total; the path table
 *  stops growing and `pathsOther` carries the rest, so the report can say it is cut. */
export const MAX_PATHS_PER_DAY = 50;
/** A target is an app filename or a fixed document path; this bounds a key built from one. */
export const MAX_TARGET_LEN = 100;
/** Months kept. Thirteen, so this month can be read against the same month last year. */
export const VISIBILITY_RETAIN_MONTHS = 13;
/** The widest report window, in days. */
export const VISIBILITY_DAYS_MAX = 400;
export const VISIBILITY_DAYS_DEFAULT = 30;

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────

export const VISIBILITY_MONTH_PREFIX = 'signals.visibility.month.';
export const visibilityMonthKey = (month: string): string => `${VISIBILITY_MONTH_PREFIX}${month}`;
export const VISIBILITY_SETTINGS_KEY = 'signals.visibility.settings';
export const VISIBILITY_MONTH_SPEC = '/docs/specs/visibility-contract.md';

// ── The day ───────────────────────────────────────────────────────────────────────────────────

/** One target's fetches on one day. */
export interface VisibilityPathCounts {
  /** People. */
  h: number;
  /** Assistant fetches by AI family: a person asked an AI, and it fetched this to answer. */
  a: Record<string, number>;
  /** Crawler fetches by AI family: an index or a training corpus, nobody waiting. */
  c: Record<string, number>;
}

/** Purchases under one attribution, with the amount per currency in 6-decimal micro-units. */
export interface VisibilityPurchaseCounts {
  n: number;
  amounts: Record<string, number>;
}

export interface VisibilityDay {
  /** Every counted request, the opted-out ones included. */
  total: number;
  /** Requests that sent `Sec-GPC: 1` or `DNT: 1`. They are in `total` and in nothing else. */
  optedOut: number;
  /** By who: human / ai / bot (signals/visitor-class.ts). */
  classes: Record<string, number>;
  /** PEOPLE by where they came from. Machines carry no meaningful Referer, so they are left out. */
  channels: Partial<Record<VisitChannel, number>>;
  /** PEOPLE who came from an AI's answer, by AI family. */
  aiReferrals: Record<string, number>;
  /** Assistant fetches by AI family. */
  assistant: Record<string, number>;
  /** Crawler fetches by AI family. */
  crawler: Record<string, number>;
  /** Per target. Keys are owner-published names, cleaned and capped (MAX_PATHS_PER_DAY). */
  paths: Record<string, VisibilityPathCounts>;
  /** Fetches whose target did not fit in `paths`. */
  pathsOther: number;
  /** Discovery-file fetches: doc → fetcher (an AI family, or `human` / `bot`) → count. */
  discovery: Record<string, Record<string, number>>;
  /** Purchases keyed `channel|family|via`, each part from a closed list. */
  purchases: Record<string, VisibilityPurchaseCounts>;
}

export interface VisibilityMonthRecord {
  type: 'aimeat.visibility.month';
  spec: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  /** Keyed `YYYY-MM-DD`. Only days with a count appear. */
  days: Record<string, VisibilityDay>;
  updatedAt: string;
}

/**
 * The owner's settings. Absent means on: counting is the default, and the owner may turn it off.
 * The two ids are the analytics the owner already uses (layer B), added by the place to its pages;
 * null when not set.
 */
export interface VisibilitySettings {
  enabled: boolean;
  /** A Microsoft Clarity project id. */
  clarityProjectId: string | null;
  /** A Google Analytics 4 measurement id (`G-…`). */
  ga4MeasurementId: string | null;
  updatedAt: string;
}

export function emptyVisibilityDay(): VisibilityDay {
  return {
    total: 0, optedOut: 0, classes: {}, channels: {}, aiReferrals: {}, assistant: {}, crawler: {},
    paths: {}, pathsOther: 0, discovery: {}, purchases: {},
  };
}

export function emptyVisibilityMonth(month: string, now: string): VisibilityMonthRecord {
  return { type: 'aimeat.visibility.month', spec: VISIBILITY_MONTH_SPEC, month, days: {}, updatedAt: now };
}
