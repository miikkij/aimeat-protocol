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
 * @structure canonicalAiAppId · namesSignedApp · appSpentToday · appQuotaFor · appAllowlisted · bareNameOnlyEntry ·
 *   mergePerApp
 * @usage
 *   const appKey = canonicalAiAppId(call.appId, gaii) || '_unknown';
 * @version-history
 *   2026-10-27 -- bareNameOnlyEntry: which bare allowlist entry lets another author's app in by its file
 *     name alone, so the owner can be told (secaudit2026oct26).
 *   2026-10-25 — A cap or allowlist entry under the name an app called itself also holds for the
 *     signed app reference an app grant's call is now attributed to (entryNamesApp; secaudit2026oct22).
 *   2026-10-19 — namesSignedApp: does a body app_id name the app token's own app, under any of its
 *     names (wish-voice-routes-accept-the-app-s-own-file-name-as-app-id).
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

/**
 * True when `requested` names the signed app `signed` (`owner/filename`, an app token's `app` claim)
 * under any of its names: the bare file name with or without `.html`, or the full reference. The
 * comparison is canonicalAiAppId relative to the APP's owner, not the caller's, so a person using
 * another owner's app may send that app's bare file name. A name of any other app is false.
 */
export function namesSignedApp(requested: string, signed: string): boolean {
  const slash = signed.indexOf('/');
  const appOwner = slash > 0 ? signed.slice(0, slash) : undefined;
  const want = canonicalAiAppId(signed, appOwner);
  return want !== undefined && canonicalAiAppId(requested, appOwner) === want;
}

/** What this app has spent today, across every name it was recorded under. */
export function appSpentToday(perApp: PerApp | undefined, appId: string, ownerGhii?: string): number {
  const want = canonicalAiAppId(appId, ownerGhii);
  let spent = 0;
  for (const [k, v] of Object.entries(perApp ?? {})) {
    if (canonicalAiAppId(k, ownerGhii) === want) spent += v?.cost_usd ?? 0;
  }
  return spent;
}

/**
 * True when an owner's setting entry (a cap's or an allowlist's key) names this app. A signed app
 * reference (`author/file.html`, from an app grant) also matches an entry under the name the app
 * called itself in the body (`file`), the name the owner saw on the AI page before the call was
 * attributed to the signed app (secaudit2026oct22).
 */
function entryNamesApp(entry: unknown, appId: string, ownerGhii?: string): boolean {
  if (canonicalAiAppId(entry, ownerGhii) === canonicalAiAppId(appId, ownerGhii)) return true;
  return appId.includes('/') && typeof entry === 'string' && namesSignedApp(entry, appId);
}

/** The owner's daily cap for this app, whichever name they saved it under, or `fallback`. */
export function appQuotaFor(
  quotas: Record<string, { daily_usd?: number } | undefined> | undefined,
  appId: string, ownerGhii: string | undefined, fallback: number,
): number {
  for (const [k, v] of Object.entries(quotas ?? {})) {
    if (entryNamesApp(k, appId, ownerGhii) && typeof v?.daily_usd === 'number') return v.daily_usd;
  }
  return fallback;
}

/** True when the owner's allowlist names this app under any of its names. */
export function appAllowlisted(allowlist: unknown[], appId: string, ownerGhii?: string): boolean {
  return allowlist.some(e => entryNamesApp(e, appId, ownerGhii));
}

/**
 * The bare entry (`notes`) through which ANOTHER author's signed app (`bob/notes.html`) is in the
 * owner's list, when no entry names that app with its author: the 2026-10-25 compatibility match
 * above, which also lets in any other author's app of the same file name. Undefined for the owner's
 * own app, for an app an entry names exactly, and for an app no entry names. The owner is told of
 * the match once (services/ai/app-name-notice.ts; secaudit2026oct26).
 */
export function bareNameOnlyEntry(entries: unknown[], appId: string, ownerGhii?: string): string | undefined {
  const app = canonicalAiAppId(appId, ownerGhii);
  if (!app || !app.includes('/')) return undefined;
  if (entries.some(e => canonicalAiAppId(e, ownerGhii) === app)) return undefined;
  const hit = entries.find(e => typeof e === 'string' && !e.includes('/') && namesSignedApp(e, appId));
  return typeof hit === 'string' ? hit : undefined;
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
