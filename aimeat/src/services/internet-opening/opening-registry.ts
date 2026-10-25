/**
 * @file src/services/internet-opening/opening-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The openings in force, kept in memory, so the content-access gate and the app gate
 *   answer "is this app or form open to the internet" without a storage read on every request. It
 *   holds one entry per app that is open now, which is a handful, not a number that grows with the
 *   person's data. It is reloaded at start, after every change an opening service makes, and by the
 *   hourly sweep; an entry whose end date has passed stops counting at once, before the sweep closes
 *   its record.
 * @structure refreshOpenings · isAppOpenToInternet · openingOfApp · isFormOpenToInternet · isTargetOpenToInternet ·
 *   anyOpenings · INTAKE_ROUTE · isOpenedIntakeRoute
 * @usage if (isAppOpenToInternet(app.ownerName, app.filename)) ...
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { logger } from '../../utils/logger.js';
import { listOpenings, type OpeningCtx } from './opening-store.js';
import type { InternetOpening, IntakeFormRef } from './opening-types.js';

/** The same key as app-intake-forms.ts intakeFormKey, written here so app-access.ts, which reads this
 *  module, pulls in nothing of the publish path. */
const intakeFormKey = (f: IntakeFormRef) => `${f.org}/${f.ws}/${f.formId}`;

let openApps = new Map<string, InternetOpening>();
let openForms = new Map<string, string>();   // form key → the app id that opened it

function live(o: InternetOpening | undefined, now: string): o is InternetOpening {
  return !!o && o.state === 'open' && (!o.until || o.until > now);
}

/** Reload the openings in force from storage. Never throws: a failed read keeps the last list. */
export async function refreshOpenings(ctx: OpeningCtx): Promise<void> {
  try {
    const now = new Date().toISOString();
    const apps = new Map<string, InternetOpening>();
    const forms = new Map<string, string>();
    for (const o of await listOpenings(ctx)) {
      if (!live(o, now)) continue;
      apps.set(o.id, o);
      for (const f of o.forms) forms.set(intakeFormKey(f), o.id);
    }
    openApps = apps;
    openForms = forms;
  } catch (err) {
    logger.warn('refreshOpenings: the openings were not reloaded; the last list stays in force', { error: String(err) });
  }
}

export function openingOfApp(owner: string, filename: string): InternetOpening | undefined {
  const o = openApps.get(`${owner}/${filename}`);
  return live(o, new Date().toISOString()) ? o : undefined;
}

export function isAppOpenToInternet(owner: string, filename: string): boolean {
  return openingOfApp(owner, filename) !== undefined;
}

export function isFormOpenToInternet(org: string, ws: string, formId: string): boolean {
  const app = openForms.get(intakeFormKey({ org, ws, formId }));
  return !!app && live(openApps.get(app), new Date().toISOString());
}

/** True when the app `owner/filename` (a subdomain site's target) is open to the internet. */
export function isTargetOpenToInternet(target: string | null | undefined): boolean {
  return !!target && live(openApps.get(target), new Date().toISOString());
}

/** True when any app is open: the gate skips its lookups on a node with none. */
export function anyOpenings(): boolean {
  return openApps.size > 0;
}

/**
 * The public intake routes (routes/organisms/intake.ts, intake-thread.ts): the descriptor and the
 * submit at the form's own address, and the conversation steps under it.
 */
export const INTAKE_ROUTE = /^\/v1\/intake\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(\/thread(?:\/read|\/forget)?)?$/;

/**
 * True when this request is a public intake route of a form that is open to the internet. The ids
 * are matched as written: an organism, workspace and form id hold no character a URL escapes
 * (services/app-intake-forms.ts), so an escaped segment names no opened form.
 */
export function isOpenedIntakeRoute(method: string, rawPath: string): boolean {
  if (openForms.size === 0) return false;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  const m = INTAKE_ROUTE.exec(path);
  if (!m || m[1] === 'forms') return false;
  const verb = method === 'HEAD' ? 'GET' : method;
  if (m[4] ? verb !== 'POST' : verb !== 'GET' && verb !== 'POST') return false;
  return isFormOpenToInternet(m[1], m[2], m[3]);
}
