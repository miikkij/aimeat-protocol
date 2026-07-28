/**
 * @file exchange/sell.js
 * @description The SELL half of AIMEAT.exchange — putting a capability on the market and watching
 *   what it does. Three kinds of supply share one publish call: a raw extension action, an app-tool
 *   a provider app sells cross-app, and a task type one of the owner's agents performs. Pricing is
 *   never sent from here in a way the server would trust — the node reads it authoritatively from
 *   the source — so `publish` carries the framing (title, terms, provenance, ODPS block) and the
 *   coordinate, and the price follows from what the source declares.
 *
 *   `stats` and `consumers` are the two halves of "is this being used, and by whom". `consumers` is
 *   provider-only and carries the breakdown underneath each row: the human who pays, and beneath
 *   them their agents, apps and ecosystem apps — which is how an app answers "is my data being read
 *   from an application, or by an agent directly?".
 * @structure publish(spec) · update(id, patch) · delist(id, opts) · stats(id) · consumers(id) ·
 *   reconcile(opts) · providerHistory() · grants() · grant(spec) · revokeGrant(spec) · normalizeSpec
 * @usage await AIMEAT.exchange.publish({ ext: 'prh-api', action: 'validate', title: '…', usageTerms: {…} });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 02 — the EXCHANGE browser library, gap G19).
 */
import { authed, pub, send, qs, exchangeError } from './client.js';
import { get as getOffering } from './browse.js';

const enc = encodeURIComponent;

/** Pick the first defined value — lets every field be written camelCase or snake_case. */
function pick(...vals) {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

/** Drop undefined keys so an unset field is absent rather than explicitly null on the wire. */
function compact(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/**
 * Normalise a listing spec into the body POST /v1/exchange/offerings expects. Accepts camelCase
 * (what a JS app writes) or the wire's snake_case, so neither habit is punished.
 * @param {Record<string, any>} spec
 * @returns {Record<string, any>}
 */
export function normalizeSpec(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  return compact({
    kind: s.kind,
    // ext-action: the extension + action you own.
    ext: s.ext,
    action: s.action,
    // app-tool: one tool of one of your apps (the node pins its interface version on listing).
    app_id: pick(s.appId, s.app_id),
    tool: s.tool,
    // agent-work: a task type one of your agents performs, settled per delivered task.
    agent_name: pick(s.agentName, s.agent_name),
    task_type: pick(s.taskType, s.task_type),
    price_morsels: pick(s.priceMorsels, s.price_morsels),
    price_money: pick(s.priceMoney, s.price_money),
    plans: s.plans,
    input_schema: pick(s.inputSchema, s.input_schema),
    output_schema: pick(s.outputSchema, s.output_schema),
    // Shared framing.
    title: s.title,
    description: s.description,
    tags: s.tags,
    usage_terms: pick(s.usageTerms, s.usage_terms),
    provenance: s.provenance,
    odps: s.odps,
  });
}

/**
 * List a supply OFFERING. The node enforces a legibility gate before anything reaches the market:
 * a published input AND output schema (`SCHEMA_REQUIRED`) and stated usage terms
 * (`USAGE_TERMS_REQUIRED`), because a listing nobody can integrate or govern is not supply. The
 * price is read from the source, so an unpriced capability is refused with `NOT_PRICED` rather than
 * listed for free.
 * @param {Record<string, any>} spec
 *   ext-action: `{ ext, action, title?, description?, tags?, usageTerms, provenance?, odps? }`
 *   app-tool:   `{ kind: 'app-tool', appId, tool, … }`
 *   agent-work: `{ kind: 'agent-work', agentName, taskType, priceMorsels|priceMoney, inputSchema, outputSchema, … }`
 * @returns {Promise<any>}  The created offering.
 */
export async function publish(spec) {
  const d = await send('/v1/exchange/offerings', 'POST', normalizeSpec(spec), 'Failed to list the offering');
  return d.offering;
}

/**
 * Change a listing's framing. DERIVED — the node has no PATCH route for an offering, deliberately:
 * a listing is a PROJECTION of its source, and the source is where price and coordinate live. So
 * this republishes the same coordinate with `patch` merged over the current framing, then delists
 * the superseded record. Consequences, stated because they are real:
 *   - the offering ID CHANGES. Existing contracts are unaffected (they key on the capability
 *     coordinate, not the listing id), but a link you published to the old id will 404.
 *   - price, plans and the metered coordinate are NOT patchable here. They come from the source —
 *     change the extension action, the tool manifest or the agent offer, then call {@link reconcile}.
 *   - a PROJECTED listing (`auto`) is refused with `SOURCE_MANAGED` rather than duplicated, because
 *     the next reconcile would overwrite whatever this wrote. The message names the source to edit.
 * @param {string} id     The offering to replace.
 * @param {Record<string, any>} patch  Framing fields (title, description, tags, usageTerms, provenance, odps).
 * @returns {Promise<any>}  The new offering.
 */
export async function update(id, patch) {
  const detail = await getOffering(id);
  const o = detail.offering;
  if (o.auto) {
    throw exchangeError({ error: {
      code: 'SOURCE_MANAGED',
      message: 'This listing is projected from its source (' + o.ext + '/' + o.action
        + '). Edit the source — the app-tool manifest, the extension action or the agent offer — then call'
        + ' AIMEAT.exchange.reconcile(). Editing the listing here would be undone by the next reconcile.',
    } }, 'This listing is managed by its source');
  }
  const surface = o.surface || {};
  const base = compact({
    kind: o.kind,
    ext: o.kind === 'ext-action' ? o.ext : undefined,
    action: o.kind === 'ext-action' ? o.action : undefined,
    appId: surface.kind === 'app-tool' ? surface.appId : undefined,
    tool: surface.kind === 'app-tool' ? surface.tool : undefined,
    agentName: surface.kind === 'agent-work' ? surface.agentName : undefined,
    taskType: surface.kind === 'agent-work' ? surface.taskType : undefined,
    priceMorsels: o.kind === 'agent-work' && o.unit === 'morsels' ? o.basePrice : undefined,
    priceMoney: o.kind === 'agent-work' && o.unit === 'money' ? { amount: o.basePrice, currency: o.currency } : undefined,
    inputSchema: o.taskSpec ? o.taskSpec.inputSchema : undefined,
    outputSchema: o.taskSpec ? o.taskSpec.outputSchema : undefined,
    title: o.title,
    description: o.description,
    tags: o.tags,
    usageTerms: o.usageTerms,
    provenance: o.provenance,
    odps: o.odps,
  });
  // Publish the replacement FIRST: if it is refused, the seller still has the listing they had.
  const next = await publish({ ...base, ...(patch || {}) });
  await delist(id).catch(() => { /* the replacement is live; a stale twin is better than no listing */ });
  return next;
}

/**
 * Delist an offering you own. A PROJECTED listing answers `SOURCE_MANAGED` (409) instead, naming
 * the source whose `exchange` flag actually controls it — pass `{ force: true }` to delist it until
 * the next reconcile brings it back.
 * @param {string} id
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<any>}
 */
export function delist(id, opts) {
  const query = qs({ force: opts && opts.force ? '1' : null });
  return authed('/v1/exchange/offerings/' + enc(id) + query, { method: 'DELETE' }, 'Failed to delist the offering');
}

/**
 * One offering's usage: `{ activeContracts, totalContracts, totalCalls, totalSettledUnits,
 * consumers, listedAt, lastUsedAt, timing: { count, p50Ms, p95Ms, maxMs } | null }`. Derived from
 * the contracts against it, so it is a real record of demand rather than a counter anyone can set.
 * Public — this is reputation. `timing` is null until the capability has actually served calls.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function stats(id) {
  const d = await pub('/v1/exchange/offerings/' + enc(id), 'No such offering');
  return d.stats;
}

/**
 * PROVIDER-ONLY lineage: one row per contract against your offering — who holds it, what they have
 * consumed, what it settled, the pacing morsels it burned, whether you are CARRYING them (a grant)
 * rather than billing them, and when they last called.
 *
 * Each row carries `callers`: the breakdown of who under that consumer actually called. The row is
 * the human who pays; underneath are their agents, apps and ecosystem apps, each with its own call
 * count and spend. That is the answer to "is this being used from an application, or by an agent
 * directly?" — and it is empty (not wrong) on contracts that predate the breakdown: the totals are
 * still right, only unattributed.
 * @param {string} id
 * @returns {Promise<{ offeringId: string, consumers: any[], count: number }>}
 */
export function consumers(id) {
  return authed('/v1/exchange/offerings/' + enc(id) + '/consumers', undefined, 'No such offering of yours');
}

/**
 * Re-project YOUR listings from their sources. Normally automatic — writing a tool manifest, an
 * extension or an agent offer projects it — this is the explicit handle.
 * @param {{ dryRun?: boolean, migrate?: boolean, appId?: string, ext?: string, agent?: string }} [opts]
 *   `dryRun` reports what would change without changing it; `migrate` adopts hand-authored listings
 *   into the projection model, keeping their offering ids so existing contracts keep resolving.
 * @returns {Promise<any>}  The reconcile report (`changes` with created/updated/adopted/delisted/skipped).
 */
export function reconcile(opts) {
  const o = opts || {};
  return send('/v1/exchange/reconcile', 'POST', compact({
    dry_run: o.dryRun, migrate: o.migrate, app_id: o.appId, ext: o.ext, agent: o.agent,
  }), 'Failed to reconcile your listings');
}

/**
 * Your PAST (archived / superseded) contracts as a PROVIDER — what a renegotiation replaced, with
 * the old terms and the final spend.
 * @returns {Promise<{ history: any[], count: number }>}
 */
export function providerHistory() {
  return authed('/v1/exchange/provider/history', undefined, 'Failed to read your provider history');
}

/**
 * Everyone you are CARRYING: grants you have issued (free access to a capability you sell, at your
 * cost) plus `carried` — what the whole guest list has cost you, per rail.
 * @param {{ appId?: string }} [opts]
 * @returns {Promise<{ grants: any[], count: number, carried: Record<string, number> }>}
 */
export function grants(opts) {
  return authed('/v1/exchange/grants' + qs({ app_id: opts && opts.appId }), undefined, 'Failed to read your grants');
}

/**
 * Issue a grant — you carry this consumer instead of billing them. Needs the `exchange:grant` scope
 * when an app asks on the owner's behalf, because it gives away the owner's revenue.
 * @param {{ consumer: string, offeringId: string, capCarriedUnits?: number, note?: string, appId?: string,
 *          reason?: { appId: string, role: string } }} spec
 * @returns {Promise<any>}  The issued grant.
 */
export async function grant(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  const d = await send('/v1/exchange/grants', 'POST', compact({
    consumer: s.consumer,
    offering_id: pick(s.offeringId, s.offering_id),
    cap_carried_units: pick(s.capCarriedUnits, s.cap_carried_units),
    note: s.note,
    app_id: pick(s.appId, s.app_id),
    reason: s.reason ? { app_id: pick(s.reason.appId, s.reason.app_id), role: s.reason.role } : undefined,
  }), 'Failed to issue the grant');
  return d.grant;
}

/**
 * Withdraw grants: `{ consumer, offeringId }` for one, or `{ appId, role?, consumer? }` for every
 * grant an app issued under an approval it is taking back. Immediate — the next call falls back to
 * whatever that consumer bought for themselves.
 * @param {{ consumer?: string, offeringId?: string, appId?: string, role?: string }} spec
 * @returns {Promise<{ revoked: number, grants: any[] }>}
 */
export function revokeGrant(spec) {
  const s = /** @type {Record<string, any>} */ (spec || {});
  return send('/v1/exchange/grants/revoke', 'POST', compact({
    consumer: s.consumer,
    offering_id: pick(s.offeringId, s.offering_id),
    app_id: pick(s.appId, s.app_id),
    role: s.role,
  }), 'Failed to withdraw the grant');
}
