/**
 * @file src/services/ai-app-id.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One name per app in the AI budget: the per-app spend, the per-app cap, the owner's
 *   app allowlist, the usage history and the decision record all key an app the same way.
 *
 *   WHY. The AI doors each named an app their own way. /v1/ai/complete took what the app sent
 *   (`paatospaja`), the decision model took the app token's file (`paatospaja.html`), and the voice
 *   doors took the token's full reference (`happydude500001/puhe.html`). One app then had two or three
 *   rows in the day's spend, a cap the owner set on one name did not hold for the others, and the
 *   per-app daily cap was split in parts. Measured on aimeat.io 2026-09-19: Päätöspaja's decisions
 *   recorded under both `paatospaja` and `paatospaja.html`.
 *
 *   THE RULE. The canonical name is the app's filename without `.html`, without the owner's own
 *   name in front: `paatospaja`, `puhe`. It is what an app calls itself, and it is its subdomain. A
 *   name with ANOTHER owner in front (an app of theirs this person uses) keeps that prefix, so it
 *   does not merge with an app of the same name this person owns. It is computed from the text
 *   alone, so every reader and writer agrees without a lookup.
 *
 *   OLD NAMES KEEP WORKING. Keys written before this rule (a cap saved under `owner/app.html`, today's
 *   spend under `app.html`) are read through the same function, so they count toward and limit the
 *   canonical app instead of being ignored.
 * @structure canonicalAiAppId · appSpentToday · appQuotaFor · appAllowlisted · mergePerApp
 * @usage
 *   const appKey = canonicalAiAppId(call.appId, gaii) || '_unknown';
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 *   v1.0.1 — 2026-09-26 — The owner prefix of an app name, and the owner it is compared with, both come
 *     from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never
 *     names the local namesake (secaudit 2026-09, F-1).
 */

import { localAccountName } from '../utils/gaii.js';

/** The account name of an owner GHII of this node (`alice@node` → `alice`); another node's stays whole. */
function ownerNameOf(ownerGhii?: string): string | undefined {
  if (!ownerGhii) return undefined;
  return localAccountName(ownerGhii);
}

/**
 * The one name an app has in the AI budget. `undefined` for no app. See the header for the rule.
 */
export function canonicalAiAppId(raw: unknown, ownerGhii?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let id = raw.trim();
  if (!id) return undefined;
  const slash = id.indexOf('/');
  if (slash > 0) {
    const prefix = localAccountName(id.slice(0, slash));
    if (prefix && prefix === ownerNameOf(ownerGhii)) id = id.slice(slash + 1);
  }
  id = id.replace(/\.html?$/i, '');
  return id || undefined;
}

type PerApp = Record<string, { cost_usd?: number } | undefined>;

/** What this app has spent today, across every name it was recorded under. */
export function appSpentToday(perApp: PerApp | undefined, appId: string, ownerGhii?: string): number {
  const want = canonicalAiAppId(appId, ownerGhii);
  let spent = 0;
  for (const [k, v] of Object.entries(perApp ?? {})) {
    if (canonicalAiAppId(k, ownerGhii) === want) spent += v?.cost_usd ?? 0;
  }
  return spent;
}

/** The owner's daily cap for this app, whichever name they saved it under, or `fallback`. */
export function appQuotaFor(
  quotas: Record<string, { daily_usd?: number } | undefined> | undefined,
  appId: string, ownerGhii: string | undefined, fallback: number,
): number {
  const want = canonicalAiAppId(appId, ownerGhii);
  for (const [k, v] of Object.entries(quotas ?? {})) {
    if (canonicalAiAppId(k, ownerGhii) === want && typeof v?.daily_usd === 'number') return v.daily_usd;
  }
  return fallback;
}

/** True when the owner's allowlist names this app under any of its names. */
export function appAllowlisted(allowlist: unknown[], appId: string, ownerGhii?: string): boolean {
  const want = canonicalAiAppId(appId, ownerGhii);
  return allowlist.some(e => canonicalAiAppId(e, ownerGhii) === want);
}

/** A per-app map with every name folded into its canonical one, sums added. For readers of history. */
export function mergePerApp<T extends Record<string, number | undefined>>(
  perApp: Record<string, T> | undefined, ownerGhii?: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(perApp ?? {})) {
    const key = canonicalAiAppId(k, ownerGhii) ?? k;
    const cur = out[key];
    if (!cur) { out[key] = { ...v }; continue; }
    const sum = { ...cur } as Record<string, number | undefined>;
    for (const [f, n] of Object.entries(v)) {
      if (typeof n === 'number') sum[f] = (sum[f] ?? 0) + n;
    }
    out[key] = sum as T;
  }
  return out;
}
