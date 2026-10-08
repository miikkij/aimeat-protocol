/**
 * @file src/services/visibility/behaviour-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The on-page behaviour report (AI visibility, layer D): for each of the owner's apps,
 *   the views by screen size, how far the page was scrolled, the dead and rage clicks by element, and
 *   the findings, one readable line each. With one app named it also carries the click grid. The
 *   owner's panel shows it and the MCP tool returns the same object.
 *
 *   A FINDING IS A COUNT PAST A THRESHOLD, said in one line the owner's AI can repeat in the owner's
 *   language: "On phones, 14 clicks on button#buy changed nothing." The fixing agent
 *   (behaviour-fixer.ts) reads the same findings, so what the owner reads is what it was asked to fix.
 * @structure readBehaviour · behaviourFindings · BehaviourReport
 * @usage const r = await readBehaviour(storage, config, ownerGhii, { app: 'shop.html', days: 7 });
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  BEHAVIOUR_APP_PREFIX, BEHAVIOUR_RETAIN_DAYS, SCROLL_BUCKETS, VIEWPORT_CLASSES,
  emptyBehaviourDay, type BehaviourAppRecord, type BehaviourDay, type BehaviourFinding,
} from '../../models/behaviour-schemas.js';
import { dayOf } from '../../models/signal-schemas.js';
import { flushBehaviour, mergeBehaviourDay, normalizeBehaviourDay } from './behaviour-counter.js';
import { getBehaviourSettings, nodeWatchesBehaviour } from './behaviour-settings.js';
import { getVisibilitySettings } from './visibility-settings.js';

/** A dead click is a finding from this many on one element on one screen size. */
const DEAD_MIN = 3;
const RAGE_MIN = 2;
/** The scroll finding needs this many views on a screen size to say anything. */
const SCROLL_MIN_VIEWS = 10;
const MAX_FINDINGS = 10;

const SCREEN: Record<string, string> = { phone: 'phones', tablet: 'tablets', desktop: 'computers' };

export interface BehaviourAppReport {
  app: string;
  /** The app is switched off: its pages carry no script, and what was counted before stays. */
  counting: boolean;
  views: number;
  opted_out: number;
  screens: Record<string, number>;
  /** Views by the deepest part of the page they reached, in per cent. */
  scroll: Record<string, number>;
  dead_clicks: Array<{ screen: string; element: string; clicks: number }>;
  rage_clicks: Array<{ screen: string; element: string; clicks: number }>;
  findings: BehaviourFinding[];
  /** Only when one app is asked for: clicks by screen size and grid cell (`column,row`). */
  heat?: Record<string, Record<string, number>>;
}

export interface BehaviourReport {
  counting: boolean;
  node_enabled: boolean;
  fixer: boolean;
  days: number;
  from: string;
  to: string;
  apps: BehaviourAppReport[];
  reading: Record<'clicks' | 'dead' | 'rage' | 'scroll' | 'heat' | 'privacy' | 'fixer', string>;
}

const rows = (o: Record<string, number>) => Object.entries(o)
  .map(([key, clicks]) => { const [screen = 'other', element = 'other'] = key.split('|'); return { screen, element, clicks }; })
  .sort((a, b) => b.clicks - a.clicks);

/** The findings for one app's summed window. */
export function behaviourFindings(sum: BehaviourDay): BehaviourFinding[] {
  const out: BehaviourFinding[] = [];
  for (const r of rows(sum.dead)) {
    if (r.clicks < DEAD_MIN || r.element === 'other') continue;
    out.push({ kind: 'dead', vc: r.screen, element: r.element, count: r.clicks,
      text: `On ${SCREEN[r.screen] ?? r.screen}, ${r.clicks} clicks on ${r.element} changed nothing on the page.` });
  }
  for (const r of rows(sum.rage)) {
    if (r.clicks < RAGE_MIN || r.element === 'other') continue;
    out.push({ kind: 'rage', vc: r.screen, element: r.element, count: r.clicks,
      text: `On ${SCREEN[r.screen] ?? r.screen}, people clicked ${r.element} again and again ${r.clicks} times.` });
  }
  // The scroll bucket is per view, not per screen size, so the finding is said for the whole app.
  const views = SCROLL_BUCKETS.reduce((n, b) => n + (sum.scroll[b] ?? 0), 0);
  const shallow = sum.scroll['25'] ?? 0;
  if (views >= SCROLL_MIN_VIEWS && shallow / views >= 0.7) {
    out.push({ kind: 'scroll', vc: 'all', element: null, count: shallow,
      text: `${shallow} of ${views} views stopped in the first quarter of the page; what is below it is seldom seen.` });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, MAX_FINDINGS);
}

export async function readBehaviour(
  storage: Storage, config: AimeatConfig, ownerGhii: string, opts: { app?: string; days?: number } = {},
): Promise<BehaviourReport> {
  await flushBehaviour(storage, ownerGhii);
  const days = Math.max(0, Math.min(BEHAVIOUR_RETAIN_DAYS, Number.isInteger(opts.days) ? opts.days! : 7));
  const to = dayOf(new Date().toISOString());
  const from = dayOf(new Date(Date.now() - days * 86_400_000).toISOString());
  const settings = await getBehaviourSettings(storage, ownerGhii);
  const records = opts.app
    ? [await storage.getMemory(ownerGhii, `${BEHAVIOUR_APP_PREFIX}${opts.app}`)]
    : await storage.listMemory(ownerGhii, { prefix: BEHAVIOUR_APP_PREFIX });
  const apps: BehaviourAppReport[] = [];
  for (const row of records) {
    const rec = row?.value as unknown as BehaviourAppRecord | undefined;
    if (!rec || typeof rec.app !== 'string') continue;
    const sum = emptyBehaviourDay();
    for (const [day, d] of Object.entries(rec.days ?? {})) {
      if (day >= from && day <= to) mergeBehaviourDay(sum, normalizeBehaviourDay(d), true);
    }
    apps.push({
      app: rec.app,
      counting: !settings.offApps.includes(rec.app),
      views: sum.views,
      opted_out: sum.optedOut,
      screens: Object.fromEntries(VIEWPORT_CLASSES.map((v) => [v, sum.vc[v] ?? 0])),
      scroll: Object.fromEntries(SCROLL_BUCKETS.map((b) => [b, sum.scroll[b] ?? 0])),
      dead_clicks: rows(sum.dead).slice(0, 25),
      rage_clicks: rows(sum.rage).slice(0, 25),
      findings: behaviourFindings(sum),
      ...(opts.app ? { heat: sum.heat } : {}),
    });
  }
  apps.sort((a, b) => b.findings.length - a.findings.length || b.views - a.views);
  return {
    // The owner's visibility switch (layer A) turns every count off, this one included.
    counting: nodeWatchesBehaviour(config) && (await getVisibilitySettings(storage, ownerGhii)).enabled,
    node_enabled: nodeWatchesBehaviour(config),
    fixer: settings.fixer,
    days, from, to, apps,
    reading: {
      clicks: 'Counts of page views of each app, by screen size: phone (under 600 pixels wide), tablet (under 1024) and computer.',
      dead: 'A dead click is a click on something that looks clickable (a button, a link within the page, an element with a pointer cursor) after which nothing on the page changed within a second. It usually means a button that does not work, or one that works too slowly to look as if it did.',
      rage: 'A rage click is three or more clicks in one spot within a moment: a person who expected something to happen.',
      scroll: 'Views by the deepest part of the page they reached: 25 is the first quarter, 100 the end.',
      heat: 'Clicks by grid cell: 12 columns across the screen, and rows a quarter of the screen high from the top of the page.',
      privacy: 'No address, cookie, visitor id, keystroke, input value, page text or recording is kept. An element is named by its tag, id and first class. A browser that asks not to be followed is counted as a view only.',
      fixer: 'When the fixing agent is on, it reads these findings once a week, writes the findings and a corrected draft of the app, and never publishes. The live app stays as it is until you publish the draft. Each run spends your AI credit.',
    },
  };
}
