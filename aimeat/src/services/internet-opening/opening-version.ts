/**
 * @file src/services/internet-opening/opening-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What happens to an opening without anyone asking: a new version of an open app, and
 *   the passing of time.
 *
 *   A NEW VERSION keeps the app open and the operators hear of it, with who published it. The forms
 *   follow the new declaration: a form the version no longer names closes at once; a form it adds
 *   opens at once where the owner may open without asking ('self' mode, an operator, a trusted
 *   owner), and otherwise waits for an operator while the rest of the app stays open.
 *
 *   THE SWEEP runs hourly (services/core-jobs.ts): an opening past its end date closes; its owner is
 *   reminded REMIND_DAYS before; a request nobody decided within REQUEST_DAYS lapses; an opening whose
 *   app was deleted or taken down closes; an owner's trust past its end date is dropped. Then the
 *   in-memory list is reloaded.
 * @structure onAppVersionPublished · sweepOpenings
 * @usage void onAppVersionPublished(ctx, { ownerName, filename, version, by, intake });
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { intakeFormKey, type IntakeFormRef } from '../app-intake-forms.js';
import { listOpenings, updateOpening, updateOpeners, withEvent, UNCHANGED, type OpeningCtx } from './opening-store.js';
import { refreshOpenings } from './opening-registry.js';
import { tellOperators, tellOwner } from './opening-notify.js';
import { directOpening, openingMode } from './opening-policy.js';
import { REQUEST_DAYS, REMIND_DAYS, type InternetOpening } from './opening-types.js';

const keys = (forms: IntakeFormRef[]) => new Set(forms.map(intakeFormKey));

/** A new version of an app was published. Never throws: the publish is already done. */
export async function onAppVersionPublished(
  ctx: OpeningCtx, v: { ownerName: string; filename: string; version: number; by: string; intake: IntakeFormRef[] },
): Promise<void> {
  try {
    if (openingMode(ctx.config) === 'not-needed') return;
    const direct = await directOpening(ctx, v.ownerName, false);
    const at = new Date().toISOString();
    let wasOpen = false;
    let asked: IntakeFormRef[] = [];
    const stored = await updateOpening(ctx, v.ownerName, v.filename, (cur) => {
      wasOpen = false; asked = [];
      if (!cur || (cur.state !== 'open' && cur.state !== 'requested')) return UNCHANGED;
      let next: InternetOpening = withEvent({ ...cur, currentVersion: v.version }, { at, kind: 'version', by: v.by, version: v.version });
      if (cur.state !== 'open') return next;
      wasOpen = true;
      const declared = keys(v.intake);
      const removed = next.forms.filter(f => !declared.has(intakeFormKey(f)));
      if (removed.length) {
        next = withEvent({ ...next, forms: next.forms.filter(f => declared.has(intakeFormKey(f))) }, { at, kind: 'forms_removed', by: v.by, forms: removed, version: v.version });
      }
      const have = keys(next.forms);
      const added = v.intake.filter(f => !have.has(intakeFormKey(f)));
      if (!added.length) {
        // A waiting forms request keeps only what this version still names.
        if (next.formsRequest) {
          const still = (next.formsRequest.forms ?? []).filter(f => declared.has(intakeFormKey(f)));
          next = { ...next, formsRequest: still.length ? { ...next.formsRequest, forms: still } : undefined };
        }
        return next;
      }
      if (direct) return withEvent({ ...next, forms: [...next.forms, ...added] }, { at, kind: 'forms_added', by: v.by, forms: added, version: v.version });
      asked = added;
      const now = new Date();
      return withEvent({
        ...next,
        formsRequest: { kind: 'forms', reason: next.reason, days: next.days, by: v.by, at, expiresAt: new Date(now.getTime() + REQUEST_DAYS * 86_400_000).toISOString(), forms: added },
      }, { at, kind: 'forms_requested', by: v.by, forms: added, version: v.version });
    });
    if (!stored) return;
    if (wasOpen) await tellOperators(ctx, 'internet_opening_version', stored, { by: v.by, version: v.version });
    if (asked.length) await tellOperators(ctx, 'internet_opening_forms', stored, { version: v.version, forms: asked.map(intakeFormKey).join(', ') });
    await refreshOpenings(ctx);
    emitChange('internet-openings');
  } catch (err) {
    logger.warn('internet opening: a new version was not handled; the next sweep reloads the openings', { app: `${v.ownerName}/${v.filename}`, error: String(err) });
  }
}

/** One pass over every opening and the trusted owners. Answers what it changed, for the job log. */
export async function sweepOpenings(ctx: OpeningCtx, now: Date = new Date()): Promise<{ closed: number; reminded: number; lapsed: number; openersDropped: number }> {
  const at = now.toISOString();
  const remindFrom = new Date(now.getTime() + REMIND_DAYS * 86_400_000).toISOString();
  const out = { closed: 0, reminded: 0, lapsed: 0, openersDropped: 0 };
  for (const o of await listOpenings(ctx)) {
    try {
      const app = o.state === 'open' ? await ctx.storage.getApp(`${o.owner}@${ctx.config.nodeId}`, o.filename) : null;
      let notice: { type: 'internet_opening_closed' | 'internet_opening_reminder'; vars: Record<string, string> } | null = null;
      let counted: keyof typeof out | null = null;
      await updateOpening(ctx, o.owner, o.filename, (cur) => {
        notice = null; counted = null;
        if (!cur) return UNCHANGED;
        let next = cur;
        let touched = false;
        if (next.request && next.request.expiresAt <= at) {
          next = next.request.kind === 'open'
            ? withEvent({ ...next, request: undefined, state: 'request_expired' }, { at, kind: 'request_expired', note: 'No operator decided within the time a request waits.' })
            : withEvent({ ...next, request: undefined }, { at, kind: 'request_expired' });
          touched = true; counted = 'lapsed';
        }
        if (next.formsRequest && next.formsRequest.expiresAt <= at) {
          next = withEvent({ ...next, formsRequest: undefined }, { at, kind: 'request_expired', forms: next.formsRequest.forms });
          touched = true; counted = 'lapsed';
        }
        if (next.state === 'open') {
          const gone = !app ? 'The app was deleted.' : app.operatorHidden ? 'An operator took the app down.' : null;
          if (gone || (next.until && next.until <= at)) {
            const reason = gone ?? 'The end date passed.';
            next = withEvent({ ...next, state: gone ? 'closed' : 'expired', closedAt: at, closeReason: reason, request: undefined, formsRequest: undefined },
              { at, kind: gone ? 'closed' : 'expired', note: reason });
            notice = { type: 'internet_opening_closed', vars: { app: next.id, reason } };
            touched = true; counted = 'closed';
          } else if (next.until && next.until <= remindFrom && next.remindedFor !== next.until) {
            next = withEvent({ ...next, remindedFor: next.until }, { at, kind: 'reminded' });
            notice = { type: 'internet_opening_reminder', vars: { app: next.id, until: (next.until ?? '').slice(0, 10) } };
            touched = true; counted = 'reminded';
          }
        }
        return touched ? next : UNCHANGED;
      });
      const n = notice as { type: 'internet_opening_closed' | 'internet_opening_reminder'; vars: Record<string, string> } | null;
      if (n) await tellOwner(ctx, o.owner, n.type, n.vars);
      if (counted) out[counted as keyof typeof out]++;
    } catch (err) {
      logger.warn('internet opening sweep: one opening was not swept; the next pass tries again', { app: o.id, error: String(err) });
    }
  }
  await updateOpeners(ctx, (cur) => {
    const keep = cur.openers.filter(t => t.until === null || t.until > at);
    out.openersDropped = cur.openers.length - keep.length;
    return out.openersDropped ? { ...cur, openers: keep } : UNCHANGED;
  });
  await refreshOpenings(ctx);
  if (out.closed || out.reminded || out.lapsed || out.openersDropped) emitChange('internet-openings');
  return out;
}
