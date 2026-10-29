/**
 * @file src/routes/origin-owner-cookie.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own origin clears its visitors' browser storage once when the origin's label
 *   passed to a different owner since that browser last saw it.
 *
 *   WHY. A removed app's label is held for its owner and released after apps.held_label_days
 *   (services/held-app-labels.ts), and the operator can release or remap one at any time. The next app
 *   that takes the label serves on the same origin, where visitors' browsers still keep what the old
 *   app stored (its localStorage, IndexedDB, service workers, the SDK's stored session). The new
 *   owner's script could read it (secaudit2026oct26,
 *   held-app-labels.ts:sweepHeldAppLabels/released-label-reassigned-to-other-owner).
 *
 *   HOW. Every page the label's origin serves sets a host-only HttpOnly cookie naming the owner of the
 *   app it served: a hash of the account name and the account's creation time, so a name registered
 *   again by somebody else is a different owner. A visit that carries a cookie naming another owner
 *   gets `Clear-Site-Data: "storage"` once, with the new cookie. "storage" leaves cookies alone, so the
 *   visitor's sign-in on the node is not touched. A first visit (no cookie) and a visit to an origin
 *   whose owner did not change send no such header; the hold, the release and the reuse of labels are
 *   unchanged. A browser that last visited before this existed carries no cookie and is not cleared.
 *
 *   THE OTHER ORIGIN FAMILIES. The portfolio origin `<username>.portfolio.<apex>` (its label is the
 *   account name, which erasure releases for reuse) and the company origin `{slug}.co.<apex>` (a
 *   deleted company's slug is free for any account) mark their holder the same way: the portfolio's
 *   account, and the company's owning account. The next holder gets the address as before; its first
 *   served page clears the old holder's storage in each visitor's browser once (secaudit2026oct26
 *   round 8c, subdomains.ts:ensureAppSubdomain:origin-handed-to-next-name-holder).
 * @structure ORIGIN_OWNER_COOKIE · ownerMark() · markOriginOwner()
 * @usage await markOriginOwner(req, res, storage, config, app);   // before the app's page is sent
 *   await markOriginOwner(req, res, storage, config, { ownerName: sub });   // a portfolio origin
 * @version-history
 *   2026-10-29 — The portfolio and company origins call it too (secaudit2026oct26 round 8c).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';

/** The cookie that names, as a hash, the owner of the app this origin last served to this browser. */
export const ORIGIN_OWNER_COOKIE = 'aimeat_origin_owner';

/** About 400 days, the longest a browser keeps a cookie. */
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

/** The owner mark of an app: its account name and that account's creation time, hashed. */
export async function ownerMark(storage: Pick<Storage, 'getOwner'>, app: Pick<AppRecord, 'ownerName'>): Promise<string> {
  const owner = await storage.getOwner(app.ownerName);
  return createHash('sha256').update(`${app.ownerName.toLowerCase()}|${owner?.createdAt ?? ''}`).digest('base64url').slice(0, 22);
}

function cookieValue(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === ORIGIN_OWNER_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Set the owner cookie for `app`, and clear this origin's storage when the browser last saw another owner here. */
export async function markOriginOwner(
  req: Request, res: Response, storage: Pick<Storage, 'getOwner'>, config: Pick<AimeatConfig, 'baseUrl'>, app: Pick<AppRecord, 'ownerName'>,
): Promise<void> {
  const mark = await ownerMark(storage, app);
  const seen = cookieValue(req);
  if (seen === mark) return;
  if (seen) res.setHeader('Clear-Site-Data', '"storage"');
  // No `domain`: host-only, so it reaches only this origin.
  res.cookie(ORIGIN_OWNER_COOKIE, mark, { httpOnly: true, secure: config.baseUrl.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: MAX_AGE_MS });
}
