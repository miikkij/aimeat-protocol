/**
 * @file exchange/contracts.js
 * @description The BUY half of AIMEAT.exchange — accepting a contract, seeing what it has consumed,
 *   turning it off, renegotiating it, and (for agent-work) starting and receiving a task.
 *
 *   A contract here is a metered entitlement: the consumer chooses only their BUDGET, the per-call
 *   price is read authoritatively from the provider. That is why `accept` takes an offering id and a
 *   cap rather than a price — a price sent from a browser would be a price a buyer set for a seller.
 * @structure contracts() · accept(offeringId, opts) · off(contract, opts) · history() · spend() ·
 *   proposals() · propose(spec) · acceptProposal/declineProposal/withdrawProposal ·
 *   startWork(spec) · deliverWork(id, spec) · work(opts) · coordinateOf
 * @usage const c = await AIMEAT.exchange.accept('off-abc123', { capUnits: 500 });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { authed, send, qs, exchangeError } from './client.js';
import { get as getOffering } from './browse.js';

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
 * Every contract the caller's OWNER holds, with what each has consumed: budget cap, spent, calls
 * remaining, the pricing model, the pacing toll it was signed at, the rake, and `callers` — which
 * of the owner's principals ran it up.
 * @returns {Promise<{ entitlements: any[] }>}
 */
export function contracts() {
  return authed('/v1/exchange/entitlements', undefined, 'Failed to read your contracts');
}

/**
 * Accept a contract for a listed offering → mint the durable entitlement the metered gateway then
 * honours on every call. You choose the budget; the provider's price is authoritative.
 * @param {string} offeringId
 * @param {{ capUnits?: number|null, appId?: string, planId?: string, contractRef?: string,
 *           escrowParty?: 'consumer'|'provider' }} [opts]
 *   `capUnits` is YOUR spend ceiling in the offering's unit (money micro-units or morsels); omit for
 *   uncapped. Below one charge it is refused with `BUDGET_TOO_LOW` rather than minted unusable.
 *   `planId` picks a provider-declared bundle/subscription plan.
 * @returns {Promise<any>}  The minted contract.
 */
export async function accept(offeringId, opts) {
  const o = /** @type {Record<string, any>} */ (opts || {});
  const d = await send('/v1/exchange/entitlements', 'POST', compact({
    offering_id: offeringId,
    cap_units: pick(o.capUnits, o.cap_units),
    app_id: pick(o.appId, o.app_id),
    plan_id: pick(o.planId, o.plan_id),
    contract_ref: pick(o.contractRef, o.contract_ref),
    escrow_party: pick(o.escrowParty, o.escrow_party),
  }), 'Failed to accept the contract');
  return d.entitlement;
}

/**
 * Resolve whatever an app is holding — a contract row, an offering detail, an offering id, or a
 * plain `{ ext, action }` — into the metered coordinate the off-switch and proposals key on.
 * @param {any} contract
 * @returns {Promise<{ ext: string, action: string }>}
 */
export async function coordinateOf(contract) {
  if (typeof contract === 'string') {
    // An offering id (`off-…`); anything else cannot be resolved without a coordinate.
    const d = await getOffering(contract);
    return { ext: d.offering.ext, action: d.offering.action };
  }
  const c = contract || {};
  const ext = c.ext || (c.offering && c.offering.ext);
  const action = c.action || (c.offering && c.offering.action);
  if (!ext || !action) {
    throw exchangeError({ error: { code: 'BAD_REQUEST', message:
      'Name the contract by its capability coordinate ({ ext, action }), a contract row from contracts(), or an offering id.' } },
    'Unresolvable contract reference');
  }
  return { ext, action };
}

/**
 * The consumer's OFF-SWITCH. `pause` is reversible (re-accepting resumes it and carries the spend
 * forward); `revoke` is terminal. Only the contract's own consumer may.
 * @param {any} contract  A contract row, an offering id, or `{ ext, action }`.
 * @param {{ mode?: 'pause'|'revoke' }} [opts]  Default `pause`.
 * @returns {Promise<any>}
 */
export async function off(contract, opts) {
  const { ext, action } = await coordinateOf(contract);
  return send('/v1/exchange/entitlements/off', 'POST', {
    ext, action, mode: (opts && opts.mode) === 'revoke' ? 'revoke' : 'pause',
  }, 'Failed to switch the contract off');
}

/**
 * Your PAST (archived / superseded) contracts as a CONSUMER — the terms a renegotiation replaced.
 * @returns {Promise<{ history: any[], count: number }>}
 */
export function history() {
  return authed('/v1/exchange/entitlements/history', undefined, 'Failed to read your contract history');
}

/**
 * What you have spent OUTBOUND, per provider and per unit. DERIVED, not a server endpoint: the node
 * aggregates the SELLER's side (offering stats, consumer lineage, earnings) and exposes the buyer's
 * side only per app (`GET /v1/apps/cost?app_id=…`), so this folds the caller's own contracts — the
 * same records the per-app view reads — into one figure. It therefore counts exactly what the
 * caller's OWNER holds a contract for, and nothing about another of their accounts.
 * @returns {Promise<{ byProvider: any[], byUnit: Record<string, { spentUnits: number, calls: number, contracts: number }>,
 *                     totalCalls: number, totalContracts: number }>}
 */
export async function spend() {
  const { entitlements } = await contracts();
  const byUnit = /** @type {Record<string, { spentUnits: number, calls: number, contracts: number }>} */ ({});
  const providers = /** @type {Record<string, any>} */ ({});
  let totalCalls = 0;
  for (const e of entitlements || []) {
    const rail = e.unit === 'money' ? (e.currency || 'EUR') : 'morsels';
    const u = byUnit[rail] || (byUnit[rail] = { spentUnits: 0, calls: 0, contracts: 0 });
    u.spentUnits += e.budget ? e.budget.spent_units : 0;
    u.calls += e.budget ? e.budget.calls : 0;
    u.contracts += 1;
    totalCalls += e.budget ? e.budget.calls : 0;

    const key = e.provider + '|' + rail;
    const p = providers[key] || (providers[key] = {
      provider: e.provider, unit: rail, spentUnits: 0, calls: 0, contracts: 0, capabilities: [],
    });
    p.spentUnits += e.budget ? e.budget.spent_units : 0;
    p.calls += e.budget ? e.budget.calls : 0;
    p.contracts += 1;
    if (p.capabilities.indexOf(e.capability) === -1) p.capabilities.push(e.capability);
  }
  const byProvider = Object.keys(providers).map(k => providers[k])
    .sort((a, b) => b.spentUnits - a.spentUnits);
  return { byProvider, byUnit, totalCalls, totalContracts: (entitlements || []).length };
}

// ── Renegotiation ────────────────────────────────────────────────────────────

/**
 * Every contract-change proposal you are party to (incoming and outgoing).
 * @returns {Promise<{ proposals: any[], count: number }>}
 */
export function proposals() {
  return authed('/v1/exchange/proposals', undefined, 'Failed to read proposals');
}

/**
 * Propose new terms on a live contract. Either party may: a consumer renegotiates their own, a
 * provider renegotiates a named consumer's (`consumerGaii`). Nothing changes until the counterparty
 * accepts; they are notified in Profile > Messages.
 * @param {{ ext?: string, action?: string, contract?: any, consumerGaii?: string,
 *           newPricePerCall?: number, newCapUnits?: number, note?: string }} spec
 * @returns {Promise<any>}  The pending proposal.
 */
export async function propose(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  const { ext, action } = await coordinateOf(s.contract || { ext: s.ext, action: s.action });
  const d = await send('/v1/exchange/proposals', 'POST', compact({
    ext, action,
    consumer_gaii: pick(s.consumerGaii, s.consumer_gaii),
    new_price_per_call: pick(s.newPricePerCall, s.new_price_per_call),
    new_cap_units: pick(s.newCapUnits, s.new_cap_units),
    note: s.note,
  }), 'Failed to propose new terms');
  return d.proposal;
}

/** The COUNTERPARTY accepts → the old contract is archived and a new one minted at the new terms. */
export function acceptProposal(id) {
  return send('/v1/exchange/proposals/' + enc(id) + '/accept', 'POST', {}, 'Failed to accept the proposal');
}
/** The counterparty declines — the contract is unchanged. */
export function declineProposal(id) {
  return send('/v1/exchange/proposals/' + enc(id) + '/decline', 'POST', {}, 'Failed to decline the proposal');
}
/** The PROPOSER withdraws their own pending proposal. */
export function withdrawProposal(id) {
  return send('/v1/exchange/proposals/' + enc(id) + '/withdraw', 'POST', {}, 'Failed to withdraw the proposal');
}

// ── Agent work (the async surface — settled per delivered task) ───────────────

/**
 * Start a task under an agent-work contract. Nothing is charged yet: the per-task price is metered
 * when the provider DELIVERS. Without an active contract this is refused with `NO_CONTRACT` (402).
 * @param {{ offeringId: string, input?: any, note?: string }} spec
 * @returns {Promise<any>}  The open work item.
 */
export async function startWork(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  const d = await send('/v1/exchange/work', 'POST', compact({
    offering_id: pick(s.offeringId, s.offering_id), input: s.input, note: s.note,
  }), 'Failed to start the work');
  return d.work;
}

/**
 * Deliver a task you were commissioned for → settle on delivery (the consumer is charged, you are
 * credited its cut, the rake routed, the budget decremented).
 * @param {string} id
 * @param {{ output?: any, note?: string }} [spec]
 * @returns {Promise<any>}  The delivered work item.
 */
export async function deliverWork(id, spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  const d = await send('/v1/exchange/work/' + enc(id) + '/deliver', 'POST',
    compact({ output: s.output, note: s.note }), 'Failed to deliver the work');
  return d.work;
}

/**
 * Your agent-work items. `{ role: 'provider' }` for work commissioned FROM you; default is work you
 * commissioned.
 * @param {{ role?: 'consumer'|'provider' }} [opts]
 * @returns {Promise<{ work: any[], count: number, role: string }>}
 */
export function work(opts) {
  return authed('/v1/exchange/work' + qs({ role: opts && opts.role }), undefined, 'Failed to read your work items');
}
