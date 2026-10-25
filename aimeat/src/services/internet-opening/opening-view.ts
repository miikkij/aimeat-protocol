/**
 * @file src/services/internet-opening/opening-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The answers the REST routes and the MCP tools give about openings, built once: the
 *   operators' list (every opening, the trusted owners, the node's setting and the counts) and one
 *   app's view for its owner (the opening, the forms the live version declares, and whether the owner
 *   may open without asking).
 * @structure openingToApi · operatorOpeningsList · ownerOpeningView
 * @usage res.json(success(nodeId, await operatorOpeningsList(ctx, { state: 'open' })));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { resolveAppUrls } from '../app-urls.js';
import { logger } from '../../utils/logger.js';
import { listOpenings, readOpening, readOpeners, activeOpeners, type OpeningCtx } from './opening-store.js';
import { openingMode, directOpening } from './opening-policy.js';
import { REMIND_DAYS, type InternetOpening, type IntakeFormRef, type OpeningRequest } from './opening-types.js';

const formsApi = (forms: IntakeFormRef[] | undefined) => (forms ?? []).map(f => ({ org: f.org, ws: f.ws, form_id: f.formId }));
const requestApi = (r: OpeningRequest | undefined) => r ? {
  kind: r.kind, reason: r.reason, days: r.days, requested_by: r.by, requested_at: r.at, expires_at: r.expiresAt,
  ...(r.forms ? { forms: formsApi(r.forms) } : {}),
} : null;

/** One opening as the API answers it. */
export function openingToApi(o: InternetOpening, extra: { appName?: string | null; url?: string | null } = {}) {
  return {
    id: o.id, owner: o.owner, app: o.filename, app_name: extra.appName ?? null, url: extra.url ?? null,
    state: o.state, reason: o.reason, requested_by: o.requestedBy, requested_at: o.requestedAt,
    opened_under: o.openedUnder ?? null, decided_by: o.decidedBy ?? null, decided_at: o.decidedAt ?? null,
    decision_note: o.decisionNote ?? null, opened_at: o.openedAt ?? null,
    opened_version: o.openedVersion ?? null, current_version: o.currentVersion ?? null,
    forms: formsApi(o.forms), until: o.until ?? null, days: o.days,
    request: requestApi(o.request), forms_request: requestApi(o.formsRequest),
    closed_by: o.closedBy ?? null, closed_at: o.closedAt ?? null, close_reason: o.closeReason ?? null,
    history: o.history.map(e => ({
      at: e.at, kind: e.kind, by: e.by ?? null, note: e.note ?? null, version: e.version ?? null,
      ...(e.forms ? { forms: formsApi(e.forms) } : {}),
    })).reverse(),
  };
}

/** How many days before its end an opening counts as ending soon. */
const ENDING_SOON_DAYS = REMIND_DAYS;
/** How long a closed, declined or lapsed opening stays on the operators' list. */
const RECENT_DAYS = 30;

const STATES = new Set(['requested', 'open', 'declined', 'request_expired', 'expired', 'closed']);

/** The operators' list. `state` narrows it; without it, the open, the waiting and the last 30 days of the rest. */
export async function operatorOpeningsList(ctx: OpeningCtx, input: { state?: unknown } = {}) {
  const now = Date.now();
  const all = await listOpenings(ctx);
  const recentFrom = new Date(now - RECENT_DAYS * 86_400_000).toISOString();
  const state = typeof input.state === 'string' && STATES.has(input.state) ? input.state : null;
  const waiting = (o: InternetOpening) => !!(o.request || o.formsRequest);
  const shown = all.filter(o => state
    ? o.state === state
    : o.state === 'open' || waiting(o) || (o.history[o.history.length - 1]?.at ?? o.requestedAt) >= recentFrom);
  const apps = await Promise.all(shown.map(o => ctx.storage.getApp(`${o.owner}@${ctx.config.nodeId}`, o.filename).catch((err) => {
    logger.warn('operatorOpeningsList: an app was not read; its row shows no name', { app: o.id, error: String(err) });
    return null;
  })));
  const urls = await resolveAppUrls(ctx.config, ctx.storage, shown.map(o => ({ owner: o.owner, filename: o.filename })));
  const soon = new Date(now + ENDING_SOON_DAYS * 86_400_000).toISOString();
  const openers = activeOpeners(await readOpeners(ctx));
  return {
    mode: openingMode(ctx.config),
    max_days: ctx.config.appInternetOpeningMaxDays ?? 90,
    counts: {
      open: all.filter(o => o.state === 'open').length,
      waiting: all.filter(waiting).length,
      ending_soon: all.filter(o => o.state === 'open' && o.until && o.until <= soon).length,
    },
    openings: shown.map((o, i) => openingToApi(o, { appName: apps[i]?.manifest?.name ?? null, url: urls[`${o.owner}/${o.filename}`] ?? null })),
    openers: openers.map(t => ({ owner: t.owner, reason: t.reason, granted_by: t.grantedBy, granted_at: t.grantedAt, until: t.until })),
  };
}

/** One app's view for its owner or an operator. */
export async function ownerOpeningView(ctx: OpeningCtx, owner: string, filename: string, isOperator: boolean) {
  const app = await ctx.storage.getApp(`${owner}@${ctx.config.nodeId}`, filename);
  if (!app) return null;
  const opening = await readOpening(ctx, owner, filename);
  const urls = await resolveAppUrls(ctx.config, ctx.storage, [{ owner, filename }]);
  const mode = openingMode(ctx.config);
  const direct = mode === 'off' || mode === 'not-needed' ? null : await directOpening(ctx, owner, isOperator);
  return {
    mode,
    max_days: ctx.config.appInternetOpeningMaxDays ?? 90,
    may_open_directly: direct !== null,
    opens_under: direct,
    declared_forms: formsApi(app.manifest?.intake),
    opening: opening ? openingToApi(opening, { appName: app.manifest?.name ?? null, url: urls[`${owner}/${filename}`] ?? null }) : null,
  };
}
