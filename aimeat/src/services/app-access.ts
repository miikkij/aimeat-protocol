/**
 * @file src/services/app-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may OPEN an app, beside the access code (plan doc-mvcn6c7e4e5q, V2). Listing says
 *   who sees the app in a list; this says who gets it served. Three values:
 *
 *     anyone          the default, stored as no value: the link opens it, as before.
 *     signed-in       any account of this node, and its agents and apps.
 *     organism:<id>   the members of one organism.
 *
 *   A node set to signed-in content access treats every app as at least 'signed-in'.
 *
 *   The decision itself is services/audience.ts, the same one every content kind asks. The owner and
 *   an operator are exempt the way they are exempt from the code: the caller of mayOpenApp decides
 *   that, because the operator pass writes a trail line (routes/apps/read.ts operatorReads).
 * @structure APP_ACCESS_VALUES · parseAppAccessInput · appAccessOf · appAccessLevelOf · appAudience · appNeedsCodeOrPayment · appNeedsSignIn · mayOpenApp
 * @usage
 *   if (appNeedsSignIn(config, app) && !(await mayOpenApp(storage, config, app, req.auth))) → refuse
 * @version-history
 *   v1.2.0 — 2026-10-25 — An app opened to the internet on a closed node keeps the audience anyone while
 *     its opening is in force (services/internet-opening/); the app record's owner name and filename
 *     name it.
 *   v1.1.0 — 2026-10-18 — appAccessLevelOf: the setting without the organism's id, for a listing row
 *     read by someone other than the owner (plan doc-mvcn6c7e4e5q, V2.5).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V2.1).
 */
import type { Storage, AppRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { appIsPaced } from './app-pacing.js';
import { signedInOnly, type ContentAccess } from '../config-visibility.js';
import { parseAudience, audienceAllows, type Audience, type AudienceAuth } from './audience.js';
import { isAppOpenToInternet } from './internet-opening/opening-registry.js';

/** What an owner writes, and what the settings answer carries. */
export type AppAccess = 'anyone' | 'signed-in' | `organism:${string}`;

export const APP_ACCESS_VALUES = ['anyone', 'signed-in', 'organism:<id>'] as const;

/**
 * Read an owner's `access` value. Returns the value to STORE (null for anyone), or a refusal message.
 * The organism is checked by the caller, which has the storage and knows the owner.
 */
export function parseAppAccessInput(value: unknown): { store: string | null } | { refusal: string } {
  if (value === 'anyone' || value === null) return { store: null };
  if (value === 'signed-in') return { store: 'signed-in' };
  if (typeof value === 'string' && value.startsWith('organism:')) {
    const a = parseAudience(value);
    if (a?.level === 'organism') return { store: value };
  }
  return { refusal: "access must be 'anyone', 'signed-in' or 'organism:<organism id>'" };
}

/** The app's own setting, as the owner sees it. */
export function appAccessOf(app: Pick<AppRecord, 'access'> | null | undefined): AppAccess {
  const v = app?.access;
  if (v === 'signed-in') return 'signed-in';
  if (typeof v === 'string' && parseAudience(v)?.level === 'organism') return v as AppAccess;
  return 'anyone';
}

/**
 * The app's own setting as anybody but its owner reads it: the level without the organism's id
 * ('anyone' | 'signed-in' | 'organism'), so a listing says who may open an app without naming the
 * owner's organism to people outside it.
 */
export function appAccessLevelOf(app: Pick<AppRecord, 'access'> | null | undefined): 'anyone' | 'signed-in' | 'organism' {
  const own = appAccessOf(app);
  return own === 'anyone' || own === 'signed-in' ? own : 'organism';
}

/** The app fields the decision reads: its own setting, and the name an opening is kept under. */
type AppForAudience = Pick<AppRecord, 'access'> & Partial<Pick<AppRecord, 'ownerName' | 'filename'>>;

/**
 * The audience that decides who opens the app, or null for anyone. The node's own setting raises
 * 'anyone' to the node's accounts, except for an app opened to the internet
 * (services/internet-opening/), which stays open to anyone while its opening is in force.
 */
export function appAudience(config: { contentAccess?: ContentAccess }, app: AppForAudience): Audience | null {
  const own = appAccessOf(app);
  if (own === 'signed-in') return { level: 'members' };
  if (own !== 'anyone') return parseAudience(own);
  if (!signedInOnly(config)) return null;
  return app.ownerName && app.filename && isAppOpenToInternet(app.ownerName, app.filename) ? null : { level: 'members' };
}

/** True when the app needs a code or a payment before it is served (what a custom address may not hold). */
export function appNeedsCodeOrPayment(config: AimeatConfig, app: Pick<AppRecord, 'accessCode' | 'manifest'>): boolean {
  return !!app.accessCode || appIsPaced(config, app.manifest);
}

/** True when opening the app needs a sign-in (its own setting, or the node's). */
export function appNeedsSignIn(config: { contentAccess?: ContentAccess }, app: AppForAudience): boolean {
  return appAudience(config, app) !== null;
}

/** Does this caller pass the app's sign-in gate? True when the app has none. */
export async function mayOpenApp(
  storage: Storage, config: { contentAccess?: ContentAccess }, app: AppForAudience,
  auth: AudienceAuth | null | undefined,
): Promise<boolean> {
  const audience = appAudience(config, app);
  return audience === null || audienceAllows(storage, audience, auth);
}
