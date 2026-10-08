/**
 * @file src/models/behaviour-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The on-page behaviour record of one app (AI visibility, layer D): where people click,
 *   how far they scroll, which clicks did nothing (dead clicks) and which were repeated in anger
 *   (rage clicks), by the viewport class of the screen. Aggregates only, in the owner's namespace.
 *
 *   WHAT IS NOT IN IT. No address, no cookie, no visitor id, no keystroke, no page text, no recording.
 *   An element is named by its tag, its id and its first class (`button#buy.primary`), which are the
 *   app author's names, never what the page says. A click position is a cell of a coarse grid, not a
 *   pixel. This is what lets it be on by default like the rest of the visibility counts.
 *
 *   ONE KEY PER APP, with the last BEHAVIOUR_RETAIN_DAYS days in it, so an owner's key count grows
 *   with their apps and never with time (the memory key budget: 1000 keys per principal).
 * @structure VIEWPORT_CLASSES · BehaviourDay · BehaviourAppRecord · BehaviourSettings · keys and caps
 * @usage const rec = (await storage.getMemory(owner, behaviourAppKey(filename)))?.value as BehaviourAppRecord;
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */

export const VIEWPORT_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export type ViewportClass = (typeof VIEWPORT_CLASSES)[number];

/** Columns of the click grid across the viewport width. */
export const HEAT_COLS = 12;
/** Rows of the click grid, each a quarter of the viewport height, from the top of the page. */
export const HEAT_ROWS = 40;
/** Scroll depth buckets: the share of the page a view reached, in per cent. */
export const SCROLL_BUCKETS = ['25', '50', '75', '100'] as const;

/** Days kept per app. Older days are dropped when a day is merged. */
export const BEHAVIOUR_RETAIN_DAYS = 56;
/** Click-grid cells kept per viewport class per day; a click past it counts in `heatOther`. */
export const MAX_HEAT_CELLS_PER_DAY = 300;
/** Distinct elements kept per day for dead and rage clicks; the rest count under `other`. */
export const MAX_ELEMENTS_PER_DAY = 60;
/** The longest element name kept. */
export const MAX_ELEMENT_LEN = 80;
/** What one page view may report, so a forged beacon cannot fill a record in one call. */
export const MAX_CLICKS_PER_BEACON = 200;
export const MAX_ELEMENTS_PER_BEACON = 20;

export const BEHAVIOUR_APP_PREFIX = 'signals.behaviour.app.';
export const BEHAVIOUR_SETTINGS_KEY = 'signals.behaviour.settings';
export const BEHAVIOUR_RUNS_KEY = 'signals.behaviour.runs';
export const behaviourAppKey = (filename: string): string => `${BEHAVIOUR_APP_PREFIX}${filename}`;

export interface BehaviourDay {
  /** Page views that reported, the opted-out ones included. */
  views: number;
  /** Views whose browser asked not to be followed (Sec-GPC or DNT): counted here and nowhere else. */
  optedOut: number;
  /** Views by viewport class. */
  vc: Record<string, number>;
  /** Views by the deepest scroll bucket they reached. */
  scroll: Record<string, number>;
  /** Clicks by viewport class and grid cell `col,row`. */
  heat: Record<string, Record<string, number>>;
  heatOther: number;
  /** Clicks that changed nothing on an element that looks clickable, by `vc|element`. */
  dead: Record<string, number>;
  /** Three or more quick clicks in one place, by `vc|element`. */
  rage: Record<string, number>;
}

export interface BehaviourAppRecord {
  type: 'aimeat.behaviour.app';
  spec: '/docs/specs/visibility-contract.md';
  app: string;
  days: Record<string, BehaviourDay>;
  updatedAt: string;
}

export interface BehaviourSettings {
  /** Apps whose pages get no behaviour script, by filename. */
  offApps: string[];
  /** The weekly fixing agent: off until the owner switches it on, because it spends their AI credit. */
  fixer: boolean;
  updatedAt: string;
}

/** One run of the fixing agent on one app. */
export interface BehaviourRun {
  app: string;
  at: string;
  /** What triggered it: the weekly job, or the owner (or their AI) asking. */
  by: 'weekly' | 'owner';
  findings: BehaviourFinding[];
  /** A draft was written; the live app is unchanged until the owner publishes the draft. */
  draft: boolean;
  model: string | null;
  /** Why no draft was written, when none was. */
  note: string | null;
}

export interface BehaviourFinding {
  kind: 'dead' | 'rage' | 'scroll';
  vc: string;
  element: string | null;
  count: number;
  text: string;
}

/** Runs kept per owner, newest first. */
export const MAX_RUNS = 50;

export function emptyBehaviourDay(): BehaviourDay {
  return { views: 0, optedOut: 0, vc: {}, scroll: {}, heat: {}, heatOther: 0, dead: {}, rage: {} };
}

export function defaultBehaviourSettings(): BehaviourSettings {
  return { offApps: [], fixer: false, updatedAt: '' };
}
