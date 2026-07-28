/**
 * @file exchange/demand.js
 * @description The DEMAND side of AIMEAT.exchange — an app says what it needs and cannot produce
 *   itself, providers bid, the requester accepts one and a contract is minted. A need is always
 *   posted on behalf of a specific app (`appId`), which is what turns a wish into a request a
 *   provider can judge: they can see who they would be serving before offering.
 * @structure needs(opts) · postNeed(spec) · closeNeed(id) · bids(needId) · bid(needId, spec) ·
 *   acceptBid(needId, bidId, opts)
 * @usage await AIMEAT.exchange.postNeed({ appId: 'alice/crm', description: '…', spec: { requiredFields: [...] } });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { authed, pub, send, qs } from './client.js';

const enc = encodeURIComponent;

function compact(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

/**
 * Browse needs. Public. Each is enriched with `appContext` — the requesting app's published name
 * and description — so a provider judges the consumer, not just the ask.
 * @param {{ open?: boolean, mine?: boolean }} [opts]  `mine` requires a session.
 * @returns {Promise<{ needs: any[], count: number }>}
 */
export function needs(opts) {
  const o = opts || {};
  const query = qs({ open: o.open ? '1' : null, mine: o.mine ? '1' : null });
  return o.mine
    ? authed('/v1/exchange/needs' + query, undefined, 'Failed to read your needs')
    : pub('/v1/exchange/needs' + query, 'Failed to browse needs');
}

/**
 * Post an open need. `appId` is REQUIRED (`NEED_APP_REQUIRED` without it) — a need belongs to the
 * app that will call the answer. The response carries `matches`: offerings that already satisfy it,
 * so the requester can accept one directly instead of waiting for a bid.
 * @param {{ appId: string, description: string, ext?: string, action?: string,
 *           spec?: { requiredFields?: string[], format?: string, sample?: string, notes?: string,
 *                    inputSchema?: object, outputSchema?: object },
 *           usageIntent?: string, budgetUnit?: 'money'|'morsels', budgetCap?: number,
 *           autonomy?: 'supervised'|'auto' }} spec
 * @returns {Promise<{ need: any, matches: any[] }>}
 */
export function postNeed(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  return send('/v1/exchange/needs', 'POST', compact({
    app_id: pick(s.appId, s.app_id),
    description: s.description,
    ext: s.ext,
    action: s.action,
    spec: s.spec,
    usage_intent: pick(s.usageIntent, s.usage_intent),
    budget_unit: pick(s.budgetUnit, s.budget_unit),
    budget_cap: pick(s.budgetCap, s.budget_cap),
    autonomy: s.autonomy,
  }), 'Failed to post the need');
}

/** Close one of your own needs. */
export function closeNeed(id) {
  return send('/v1/exchange/needs/' + enc(id) + '/close', 'POST', {}, 'Failed to close the need');
}

/** The bids on a need. Public — demand and the answers to it are both browsable. */
export function bids(needId) {
  return pub('/v1/exchange/needs/' + enc(needId) + '/bids', 'Failed to read bids');
}

/**
 * Bid on an open need with an action YOUR extension owns (anything else is refused, 403).
 * @param {string} needId
 * @param {{ ext: string, action: string, offeringId?: string, planId?: string, note?: string }} spec
 * @returns {Promise<any>}  The open bid.
 */
export async function bid(needId, spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  const d = await send('/v1/exchange/needs/' + enc(needId) + '/bids', 'POST', compact({
    ext: s.ext, action: s.action,
    offering_id: pick(s.offeringId, s.offering_id),
    plan_id: pick(s.planId, s.plan_id),
    note: s.note,
  }), 'Failed to place the bid');
  return d.bid;
}

/**
 * The REQUESTER accepts a bid → the entitlement is minted (consumer = requester, provider = bidder)
 * at the provider's authoritative price, and the need is marked matched.
 * @param {string} needId
 * @param {string} bidId
 * @param {{ capUnits?: number }} [opts]  Defaults to the need's own budget cap.
 * @returns {Promise<any>}
 */
export function acceptBid(needId, bidId, opts) {
  const o = /** @type {Record<string, any>} */ (opts || {});
  return send('/v1/exchange/needs/' + enc(needId) + '/bids/' + enc(bidId) + '/accept', 'POST',
    compact({ cap_units: pick(o.capUnits, o.cap_units) }), 'Failed to accept the bid');
}
