/**
 * @file src/services/internet-opening/opening-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Opening one app and the intake forms it declares to the internet on a node that shows
 *   its content to signed-in accounts only (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 *   ONE IMPLEMENTATION: the REST routes (routes/internet-opening.ts), the MCP tools
 *   (mcp/internet-opening.ts) and the publish-request applier all call these functions, so a chat and
 *   a screen cannot drift apart on what an opening is.
 *
 *   The node's `visibility.app_internet_opening` decides who opens: 'self' lets the owner open with a
 *   reason and tells the operators; 'operator' (the default) turns the owner's opening into a request
 *   an operator approves or declines, except for an operator and an owner the operators trust
 *   (setTrustedOpener); 'off' refuses. Every opening has a reason, a requester, a time and an end
 *   date, and every change is an event in its history.
 *
 *   An app qualifies when its own setting lets anyone open it, it has no access code, it is not parked
 *   and no operator hid it: an opening lifts the node's sign-in rule for one app, never the owner's own.
 *   Only the app page, its own documents and its declared forms open; its other data calls stay closed.
 * @structure OpeningActor · OpeningResult · ineligible · requestOpening · closeOpening · decideOpening ·
 *   setTrustedOpener · openingOf (openingMode and directOpening re-exported from opening-policy.ts)
 * @usage const r = await requestOpening(ctx, actor, { filename: 'page.html', reason: 'Consent form for the event' });
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import type { AppRecord } from '../../storage/interface.js';
import { appAccessOf } from '../app-access.js';
import { recordAppAudit } from '../app-audit.js';
import { recordOperatorAction } from '../operator-access-audit.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { readOpening, updateOpening, updateOpeners, activeOpeners, withEvent, UNCHANGED, type OpeningCtx } from './opening-store.js';
import { refreshOpenings } from './opening-registry.js';
import { tellOperators, tellOwner } from './opening-notify.js';
import { openingMode, directOpening } from './opening-policy.js';
import { REQUEST_DAYS, type InternetOpening, type OpeningRequest } from './opening-types.js';

export { openingMode, directOpening };

/** Who acts: the principal, the account it acts for, and whether that account is an operator's. */
export interface OpeningActor {
  principal: string;
  /** The bare account name the principal acts for. */
  owner: string;
  /** True when an operator account in person, or its agent holding operator:admin. */
  operator: boolean;
}

export type OpeningFail = { ok: false; status: number; code: string; message: string };
export type OpeningResult<T> = { ok: true; data: T } | OpeningFail;

const fail = (status: number, code: string, message: string): OpeningFail => ({ ok: false, status, code, message });

const addDays = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

/** Why this app cannot be opened, or null when it can. */
export function ineligible(app: AppRecord | null): OpeningFail | null {
  if (!app) return fail(404, 'NOT_FOUND', 'App not found');
  if (!/html/i.test(app.mimeType)) return fail(422, 'NOT_A_PAGE', 'Only an HTML app can be opened to the internet.');
  if (app.operatorHidden) return fail(403, 'APP_HIDDEN', 'An operator has taken this app down, so it cannot be opened to the internet.');
  if (app.parked) return fail(409, 'APP_PARKED', 'This app is parked. Unpark it before opening it to the internet.');
  if (app.accessCode) return fail(409, 'APP_HAS_ACCESS_CODE', 'This app asks for an access code. Remove the code before opening it to the internet.');
  if (appAccessOf(app) !== 'anyone') {
    return fail(409, 'APP_NOT_OPEN_TO_ANYONE', 'This app\'s own setting lets only signed-in accounts or one organisation open it. Set who may open it to anyone first; the opening lifts the node\'s sign-in rule, not the app\'s own.');
  }
  return null;
}

function checkReason(reason: unknown): string | OpeningFail {
  const r = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ') : '';
  if (r.length < 3) return fail(400, 'INVALID_INPUT', 'Give the reason the app is opened to the internet: who it is for and what they do there.');
  if (r.length > 500) return fail(400, 'INVALID_INPUT', 'The reason is at most 500 characters.');
  return r;
}

function checkDays(ctx: OpeningCtx, days: unknown): number | OpeningFail {
  const max = ctx.config.appInternetOpeningMaxDays ?? 90;
  if (days === undefined || days === null) return max;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > max) return fail(400, 'INVALID_INPUT', `days is a whole number from 1 to ${max}, the longest this node keeps an app open.`);
  return n;
}

async function changed(ctx: OpeningCtx): Promise<void> {
  await refreshOpenings(ctx);
  emitChange('internet-openings');
  // The app rows carry open_to_internet, so the pages that list apps read them again.
  emitChange('apps');
}

function audit(ctx: OpeningCtx, o: InternetOpening, by: string, action: 'internet.requested' | 'internet.opened' | 'internet.extended' | 'internet.closed', detail: Record<string, string | number> = {}): void {
  recordAppAudit(ctx.storage, { ownerGhii: `${o.owner}@${ctx.config.nodeId}`, filename: o.filename, by, action, detail })
    .catch(err => { logger.warn('internet opening: the app audit line was not written', { app: o.id, error: String(err) }); });
}

export type OpeningOutcome = 'opened' | 'requested' | 'extended' | 'extend_requested';

/**
 * Open the actor's own app, or ask an operator to. On an app that is open it extends the end date,
 * or asks to. A caller that is not the account holder in person has passed the publish gate already
 * (the route and the MCP tool ask it, services/publish-requests/).
 */
export async function requestOpening(
  ctx: OpeningCtx, actor: OpeningActor, input: { filename: string; reason: unknown; days?: unknown },
): Promise<OpeningResult<{ opening: InternetOpening; outcome: OpeningOutcome }>> {
  const mode = openingMode(ctx.config);
  if (mode === 'not-needed') return fail(409, 'NOT_NEEDED', 'This node shows its content to anyone already, so an app needs no opening.');
  if (mode === 'off') return fail(403, 'OPENING_OFF', 'The operators of this node have switched opening apps to the internet off.');
  const reason = checkReason(input.reason);
  if (typeof reason !== 'string') return reason;
  const days = checkDays(ctx, input.days);
  if (typeof days !== 'number') return days;
  const app = await ctx.storage.getApp(`${actor.owner}@${ctx.config.nodeId}`, input.filename);
  const bad = ineligible(app);
  if (bad) return bad;
  const live = app as AppRecord;
  const direct = await directOpening(ctx, actor.owner, actor.operator);
  const now = new Date();
  const at = now.toISOString();
  let outcome: OpeningOutcome = 'opened';
  const stored = await updateOpening(ctx, actor.owner, input.filename, (cur) => {
    const isOpen = cur?.state === 'open' && (!cur.until || cur.until > at);
    if (cur && isOpen) {
      if (direct) {
        outcome = 'extended';
        return withEvent({ ...cur, reason, days, until: addDays(now, days), request: undefined }, { at, kind: 'extended', by: actor.principal, note: reason });
      }
      outcome = 'extend_requested';
      const request: OpeningRequest = { kind: 'extend', reason, days, by: actor.principal, at, expiresAt: addDays(now, REQUEST_DAYS) };
      return withEvent({ ...cur, request }, { at, kind: 'requested', by: actor.principal, note: reason });
    }
    const base: InternetOpening = {
      spec: 'aimeat.internet-opening/v1', id: `${actor.owner}/${input.filename}`, owner: actor.owner, filename: input.filename,
      state: 'requested', reason, requestedBy: actor.principal, requestedAt: at, days,
      currentVersion: live.versionNumber, forms: [], history: cur?.history ?? [],
    };
    if (direct) {
      outcome = 'opened';
      return withEvent({
        ...base, state: 'open', openedUnder: direct, openedAt: at, openedVersion: live.versionNumber,
        forms: live.manifest?.intake ?? [], until: addDays(now, days),
      }, { at, kind: 'opened', by: actor.principal, note: reason, version: live.versionNumber, forms: live.manifest?.intake ?? [] });
    }
    outcome = 'requested';
    const request: OpeningRequest = { kind: 'open', reason, days, by: actor.principal, at, expiresAt: addDays(now, REQUEST_DAYS) };
    return withEvent({ ...base, request, forms: live.manifest?.intake ?? [] }, { at, kind: 'requested', by: actor.principal, note: reason, version: live.versionNumber });
  });
  const opening = stored as InternetOpening;
  const o = opening;
  // Set inside the change function, which TypeScript does not follow.
  outcome = outcome as OpeningOutcome;
  if (outcome === 'opened') { audit(ctx, o, actor.principal, 'internet.opened', { days }); await tellOperators(ctx, 'internet_opening_opened', o); }
  if (outcome === 'requested') { audit(ctx, o, actor.principal, 'internet.requested', { days }); await tellOperators(ctx, 'internet_opening_requested', o); }
  if (outcome === 'extended') audit(ctx, o, actor.principal, 'internet.extended', { days });
  if (outcome === 'extend_requested') { audit(ctx, o, actor.principal, 'internet.requested', { days, kind: 'extend' }); await tellOperators(ctx, 'internet_opening_extend', o, { days }); }
  await changed(ctx);
  return { ok: true, data: { opening, outcome } };
}

/**
 * Close an app to the internet, or withdraw the request that waits. The owner closes their own; an
 * operator closes any, and the owner is told and the act is recorded on their account.
 */
export async function closeOpening(
  ctx: OpeningCtx, actor: OpeningActor, input: { owner: string; filename: string; reason?: unknown },
): Promise<OpeningResult<{ opening: InternetOpening }>> {
  const own = actor.owner === input.owner;
  if (!own && !actor.operator) return fail(403, 'FORBIDDEN', 'Only the app\'s owner or an operator closes it.');
  const reasonText = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : (own ? 'Closed by the owner.' : 'Closed by an operator.');
  const at = new Date().toISOString();
  let was: InternetOpening['state'] | null = null;
  const stored = await updateOpening(ctx, input.owner, input.filename, (cur) => {
    if (!cur || (cur.state !== 'open' && cur.state !== 'requested')) return UNCHANGED;
    was = cur.state;
    return withEvent({ ...cur, state: 'closed', closedBy: actor.principal, closedAt: at, closeReason: reasonText, request: undefined, formsRequest: undefined },
      { at, kind: 'closed', by: actor.principal, note: reasonText });
  });
  if (!was || !stored) return fail(409, 'NOT_OPEN', 'This app is not open to the internet and no request for it waits.');
  audit(ctx, stored, actor.principal, 'internet.closed');
  if (!own) {
    await tellOwner(ctx, input.owner, 'internet_opening_closed', { app: stored.id, reason: reasonText, by: actor.principal });
    void recordOperatorAction(ctx.storage, ctx.config, {
      operatorGhii: `${actor.owner}@${ctx.config.nodeId}`, actorGaii: actor.principal, ownerOf: `${input.owner}@${ctx.config.nodeId}`,
      area: 'app', action: 'internet_close', subject: stored.id, data: { reason: reasonText },
    });
  }
  await changed(ctx);
  return { ok: true, data: { opening: stored } };
}

/**
 * An operator approves or declines what waits on an opening: the first opening, an extension, or
 * forms a new version added (`which`, default the opening or extension, then the forms). A decline
 * names its reason; the owner reads it.
 */
export async function decideOpening(
  ctx: OpeningCtx, actor: OpeningActor,
  input: { owner: string; filename: string; decision: unknown; note?: unknown; which?: unknown },
): Promise<OpeningResult<{ opening: InternetOpening; decided: OpeningRequest['kind'] }>> {
  if (!actor.operator) return fail(403, 'FORBIDDEN', 'Only an operator decides an opening.');
  if (input.decision !== 'approve' && input.decision !== 'decline') return fail(400, 'INVALID_INPUT', 'decision is "approve" or "decline".');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  if (input.decision === 'decline' && note.length < 3) return fail(400, 'INVALID_INPUT', 'A decline names its reason in note; the owner reads it.');
  const which = input.which === 'forms' ? 'forms' : input.which === undefined ? null : 'request';
  const app = await ctx.storage.getApp(`${input.owner}@${ctx.config.nodeId}`, input.filename);
  const now = new Date();
  const at = now.toISOString();
  let decided: OpeningRequest['kind'] | null = null;
  let refusal: OpeningFail | null = null;
  const stored = await updateOpening(ctx, input.owner, input.filename, (cur) => {
    decided = null; refusal = null;
    if (!cur) return UNCHANGED;
    const req = which === 'forms' ? cur.formsRequest : which === 'request' ? cur.request : (cur.request ?? cur.formsRequest);
    if (!req) return UNCHANGED;
    decided = req.kind;
    const by = actor.principal;
    if (input.decision === 'decline') {
      const base = req.kind === 'forms' ? { ...cur, formsRequest: undefined } : { ...cur, request: undefined };
      const next = req.kind === 'open' ? { ...base, state: 'declined' as const, decidedBy: by, decidedAt: at, decisionNote: note } : base;
      return withEvent(next, { at, kind: 'declined', by, note, ...(req.forms ? { forms: req.forms } : {}) });
    }
    if (req.kind === 'forms') {
      // Only forms the live version still declares open.
      const declared = new Set((app?.manifest?.intake ?? []).map(f => `${f.org}/${f.ws}/${f.formId}`));
      const add = (req.forms ?? []).filter(f => declared.has(`${f.org}/${f.ws}/${f.formId}`));
      const have = new Set(cur.forms.map(f => `${f.org}/${f.ws}/${f.formId}`));
      return withEvent({ ...cur, formsRequest: undefined, forms: [...cur.forms, ...add.filter(f => !have.has(`${f.org}/${f.ws}/${f.formId}`))] },
        { at, kind: 'forms_added', by, note: note || undefined, forms: add });
    }
    if (req.kind === 'extend') {
      return withEvent({ ...cur, request: undefined, reason: req.reason, days: req.days, until: addDays(now, req.days), decidedBy: by, decidedAt: at, decisionNote: note || undefined },
        { at, kind: 'extended', by, note: req.reason });
    }
    const bad = ineligible(app);
    if (bad) { refusal = bad; return UNCHANGED; }
    const live = app as AppRecord;
    return withEvent({
      ...cur, request: undefined, state: 'open', openedUnder: 'operator-approval', decidedBy: by, decidedAt: at,
      decisionNote: note || undefined, openedAt: at, openedVersion: live.versionNumber, currentVersion: live.versionNumber,
      forms: live.manifest?.intake ?? [], until: addDays(now, req.days), reason: req.reason, days: req.days,
      closedBy: undefined, closedAt: undefined, closeReason: undefined,
    }, { at, kind: 'approved', by, note: note || undefined, version: live.versionNumber, forms: live.manifest?.intake ?? [] });
  });
  if (refusal) return refusal;
  if (!decided || !stored) return fail(409, 'NOTHING_TO_DECIDE', 'Nothing about this app waits for an operator\'s decision.');
  const kind = decided as OpeningRequest['kind'];
  const approved = input.decision === 'approve';
  if (approved && kind === 'open') audit(ctx, stored, actor.principal, 'internet.opened', { approved_by: actor.principal });
  if (approved && kind === 'extend') audit(ctx, stored, actor.principal, 'internet.extended', { approved_by: actor.principal });
  await tellOwner(ctx, input.owner, approved ? 'internet_opening_approved' : 'internet_opening_declined', {
    app: stored.id, by: actor.principal, until: (stored.until ?? '').slice(0, 10), note, kind,
  });
  void recordOperatorAction(ctx.storage, ctx.config, {
    operatorGhii: `${actor.owner}@${ctx.config.nodeId}`, actorGaii: actor.principal, ownerOf: `${input.owner}@${ctx.config.nodeId}`,
    area: 'app', action: `internet_${approved ? 'approve' : 'decline'}`, subject: stored.id, data: { kind, ...(note ? { note } : {}) },
  });
  await changed(ctx);
  return { ok: true, data: { opening: stored, decided: kind } };
}

/**
 * An operator lets an owner open apps without asking, or takes it back. Taking it back closes
 * nothing: what the owner opened stays open, listed, and any operator closes it there; the owner's
 * next opening or extension waits for an operator.
 */
export async function setTrustedOpener(
  ctx: OpeningCtx, actor: OpeningActor, input: { owner: string; allowed: unknown; reason?: unknown; until?: unknown },
): Promise<OpeningResult<{ openers: Array<{ owner: string; reason: string; granted_by: string; granted_at: string; until: string | null }> }>> {
  if (!actor.operator) return fail(403, 'FORBIDDEN', 'Only an operator decides who opens apps without asking.');
  if (typeof input.allowed !== 'boolean') return fail(400, 'INVALID_INPUT', 'allowed is true or false.');
  const account = await ctx.storage.getOwner(input.owner);
  if (!account) return fail(404, 'NOT_FOUND', 'No account of that name on this node.');
  let reason = '';
  let until: string | null = null;
  if (input.allowed) {
    const r = checkReason(input.reason);
    if (typeof r !== 'string') return fail(400, 'INVALID_INPUT', 'Give the reason this person may open apps without asking.');
    reason = r;
    if (input.until !== undefined && input.until !== null && input.until !== '') {
      const t = new Date(String(input.until));
      if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return fail(400, 'INVALID_INPUT', 'until is a date in the future, or left out for no end.');
      until = t.toISOString();
    }
  }
  const at = new Date().toISOString();
  const rec = await updateOpeners(ctx, (cur) => {
    const rest = cur.openers.filter(o => o.owner !== input.owner);
    if (!input.allowed && rest.length === cur.openers.length) return UNCHANGED;
    return { ...cur, openers: input.allowed ? [...rest, { owner: input.owner, reason, grantedBy: actor.principal, grantedAt: at, until }] : rest };
  });
  await tellOwner(ctx, input.owner, input.allowed ? 'internet_opening_trusted' : 'internet_opening_untrusted', { by: actor.principal, reason });
  void recordOperatorAction(ctx.storage, ctx.config, {
    operatorGhii: `${actor.owner}@${ctx.config.nodeId}`, actorGaii: actor.principal, ownerOf: `${input.owner}@${ctx.config.nodeId}`,
    area: 'account', action: input.allowed ? 'internet_opener_granted' : 'internet_opener_removed', subject: input.owner, data: reason ? { reason } : {},
  });
  emitChange('internet-openings');
  return { ok: true, data: { openers: activeOpeners(rec).map(o => ({ owner: o.owner, reason: o.reason, granted_by: o.grantedBy, granted_at: o.grantedAt, until: o.until })) } };
}

/** The opening of one app, or null. */
export async function openingOf(ctx: OpeningCtx, owner: string, filename: string): Promise<InternetOpening | null> {
  return readOpening(ctx, owner, filename);
}
