/**
 * @file exchange/beneficiaries.js
 * @description Revenue you SHARE — the second rake, from a browser.
 *
 *   The platform rake takes a percent of what the buyer pays and routes it to the operator. This takes
 *   a percent of what YOU earn and routes it to other accounts. The distinction that matters, and the
 *   one an app should show its users plainly: the pool comes out of the seller's cut, never out of the
 *   buyer's charge. Declaring a split does not make anything more expensive for anyone; it makes the
 *   seller's own revenue land somewhere else.
 *
 *   THREE ROLES, and an app usually renders only one of them at a time:
 *     - as a SELLER — `declareSplit`, `splits`, `deleteSplit`, `obligations`, `release`;
 *     - as a BENEFICIARY — `earnings` (what you are owed, and whether it is payable yet);
 *     - as an OPERATOR — `approve`, the gate between owed and paid.
 *
 *   WHAT THIS LIBRARY DELIBERATELY CANNOT DO. It cannot set a price, an amount, or a currency on a
 *   share, and it cannot make one payable. `pool_percent` is server-held provider configuration read
 *   at settlement, and the verification gate is operator-only — so nothing a page sends can enlarge a
 *   payout or open the gate on its own. Amounts here are always REPORTED, never proposed.
 * @structure declareSplit · splits · deleteSplit · earnings · obligations · release · approval ·
 *   approve · payoutQuote · payout
 * @usage
 *   await AIMEAT.exchange.declareSplit({ ext: 'kumppani', action: 'getRegisterChanges',
 *     poolPercent: 70, dynamic: true });
 *   const owed = await AIMEAT.exchange.beneficiaryEarnings();   // owed.verification.payable
 * @version-history
 *   v1.1.0 — 2026-07-30 — payoutQuote + payout: the leg where the money actually reaches them.
 *   v1.0.0 — 2026-07-30 — Initial: the beneficiary surface of the EXCHANGE library.
 */
import { authed, send, qs } from './client.js';

/**
 * Declare (or replace) who shares what one capability earns.
 *
 * `poolPercent` is the share of YOUR cut that leaves you, 0-100 — after the platform rake, never out
 * of the buyer's charge. `beneficiaries` are owner GHIIs with relative `weight`s: two at weight 1
 * split the pool evenly, 3 and 1 split it 75/25. Omit `weight` for an equal share.
 *
 * Set `dynamic: true` when WHO deserves a share depends on what the call was about — a lookup service
 * owing the party it looked up. The capability then names destinations per call by returning
 * `_revenue: { beneficiaries: [{ ghii, weight }] }`, which the node strips before the buyer sees the
 * result. It names destinations ONLY: the pool size stays this declaration's, so a capability can
 * redirect a share you already committed and can never enlarge its own payout. A dynamic split may
 * have no static beneficiaries at all; one with neither is refused, because it would divide nothing.
 *
 * Always written against the CALLER's own revenue — you cannot declare that someone else's capability
 * shares its earnings. Needs the `exchange:beneficiary` permission when an app is calling.
 * @param {{ ext: string, action: string, poolPercent: number,
 *   beneficiaries?: Array<{ ghii: string, weight?: number, note?: string }>,
 *   dynamic?: boolean, capability?: string, state?: 'active'|'paused' }} spec
 * @returns {Promise<any>}  `{ split, note }`
 */
export function declareSplit(spec) {
  const s = spec || /** @type {any} */ ({});
  return send('/v1/commerce/beneficiary-splits', 'POST', {
    ext: s.ext,
    action: s.action,
    pool_percent: s.poolPercent,
    beneficiaries: s.beneficiaries || [],
    dynamic: !!s.dynamic,
    capability: s.capability,
    state: s.state,
  }, 'Failed to declare the revenue split');
}

/**
 * Every split you have declared. Owner-scoped by the server — only your own, never another seller's.
 * @returns {Promise<any>}  `{ splits, count }`
 */
export function splits() {
  return authed('/v1/commerce/beneficiary-splits', undefined, 'Failed to read your revenue splits');
}

/**
 * Withdraw a split. Future calls keep your whole cut; shares already accrued still stand, because what
 * was earned does not un-happen when the arrangement ends.
 * @param {string} ext
 * @param {string} action
 * @returns {Promise<any>}  `{ removed, note }`
 */
export function deleteSplit(ext, action) {
  return send('/v1/commerce/beneficiary-splits' + qs({ ext, action }), 'DELETE', undefined,
    'Failed to withdraw the revenue split');
}

/**
 * What YOU have been given a share of, and whether it can be paid yet.
 *
 * The debtor on every entry is the PROVIDER whose call it came from — a share is owed by the seller
 * out of their own earnings, not by the buyer. `verification.payable` is the honest answer to "when do
 * I get this": false means the amount is booked and real but no operator has verified the account yet,
 * and it stays booked until one does.
 *
 * `totals` is keyed by unit: a currency code for real money (integer micro-units), and `morsels` for
 * the node's pacing meter. They are never added together and they are not the same KIND of thing, so
 * render them separately with {@link module:exchange/format.fmtUnit} and never sum them into a
 * headline figure. A EUR share is income; a morsel share is capacity to call things.
 * @param {{ status?: 'accrued'|'released'|'reversed', limit?: number }} [opts]
 * @returns {Promise<any>}  `{ beneficiary, verification, totals, entries, count, note }`
 */
export function earnings(opts) {
  const o = opts || {};
  return authed('/v1/commerce/beneficiary/earnings' + qs({ status: o.status, limit: o.limit }),
    undefined, 'Failed to read what you are owed');
}

/**
 * What YOU owe your beneficiaries — the seller's side of the same book.
 *
 * Nothing was withheld when the call settled: you received your whole cut and are holding it. These
 * are the obligations against it, each with the `tracking_code` {@link release} needs.
 * @param {{ status?: 'accrued'|'released'|'reversed', limit?: number }} [opts]
 * @returns {Promise<any>}  `{ provider, totals, entries, count }`
 */
export function obligations(opts) {
  const o = opts || {};
  return authed('/v1/commerce/beneficiary/obligations' + qs({ status: o.status, limit: o.limit }),
    undefined, 'Failed to read what you owe');
}

/**
 * Pay one accrued share. Only the provider who owes it can, and only their own obligations.
 *
 * Refuses with code `BENEFICIARY_UNVERIFIED` until an operator has verified that beneficiary — check
 * `earnings().verification` or {@link approval} before offering the button, so a user is told why
 * rather than shown a failure.
 *
 * `settled_here` says whether the release COMPLETED on this node. On morsels it did, because morsels
 * are the node's own pacing meter and moving them moves consumption capacity rather than currency. On
 * money it did not: the amount is booked onto the beneficiary's payable book and the fiat leg is
 * invoiced off-node, because a node that pushed fiat would first have to hold it. Read it as "is
 * there anything left to do", never as "which rail is the real one" — the rail that settles instantly
 * is precisely the one that is not money.
 * @param {string} trackingCode  From {@link obligations}.
 * @param {string} beneficiary   The beneficiary's owner GHII.
 * @returns {Promise<any>}  `{ released, amount, unit, currency, method, settled_here, note }`
 */
export function release(trackingCode, beneficiary) {
  return send('/v1/commerce/beneficiary/release', 'POST',
    { tracking_code: trackingCode, beneficiary }, 'Failed to release the share');
}

/**
 * Whether an account may be paid a beneficiary share. Reads your OWN by default; reading another
 * account's needs the operator role and 403s otherwise.
 * @param {string} [ghii]
 * @returns {Promise<any>}  `{ ghii, approval, state, payable, message }`
 */
export function approval(ghii) {
  return authed('/v1/commerce/beneficiary/approvals' + qs({ ghii }), undefined,
    'Failed to read the verification state');
}

/**
 * Record what was established about a beneficiary before money may reach them. OPERATOR ONLY — a gate
 * a provider could open for their own payees would not be a gate.
 *
 * `method` says HOW representation was established and is required when verifying; the node keeps no
 * list of acceptable methods, because which evidence suffices is a judgement that varies by
 * jurisdiction and by what is being claimed. `subject` optionally names the external identity the
 * approval attests the account may act for (`fi-ytunnus:3323553-5`) and is opaque to the node.
 * @param {{ ghii: string, state: 'verified'|'unverified'|'rejected', method?: string,
 *   subject?: string, evidence?: string }} finding
 * @returns {Promise<any>}  `{ approval }`
 */
export function approve(finding) {
  const f = finding || /** @type {any} */ ({});
  return send('/v1/commerce/beneficiary/approvals', 'POST', {
    ghii: f.ghii, state: f.state, method: f.method, subject: f.subject, evidence: f.evidence,
  }, 'Failed to record the verification');
}

/**
 * What you still owe a beneficiary, and the x402 requirements to pay it.
 *
 * The last leg. Neither money handler can push a provider's funds to a third party, so a
 * provider-to-beneficiary transfer is a separate payment that its payer authorises: this returns
 * exact-scheme requirements to sign with the wallet holding the funds, and {@link payout} settles
 * them. Aggregated across everything released and unpaid in one currency, so one signature clears
 * the balance instead of paying gas on every sub-euro share.
 *
 * `payable: false` with `reason: 'BENEFICIARY_NO_ADDRESS'` is not an error: they have set no payout
 * address, so the obligation simply stays owed, which is what an unpaid invoice is.
 * @param {string} beneficiary  Their owner GHII.
 * @param {string} [currency]   Defaults to EUR.
 * @returns {Promise<any>}  `{ payable, reason, message, amount, currency, entries, pay_to, accepts }`
 */
export function payoutQuote(beneficiary, currency) {
  return authed('/v1/commerce/beneficiary/payout' + qs({ beneficiary, currency }), undefined,
    'Failed to read what you owe this beneficiary');
}

/**
 * Settle it with the signed authorisation from {@link payoutQuote}.
 *
 * The quote is rebuilt server-side, so a signature can only ever move what is genuinely owed at that
 * instant. Entries become `paid` only once the facilitator confirms, so a failed settlement leaves
 * them payable and a confirmation arriving twice cannot pay twice.
 * @param {string} beneficiary  Their owner GHII.
 * @param {any} payment         The signed x402 exact-scheme payload.
 * @param {string} [currency]
 * @returns {Promise<any>}  `{ paid, amount, currency, entries, tx_hash, pay_to }`
 */
export function payout(beneficiary, payment, currency) {
  return send('/v1/commerce/beneficiary/payout', 'POST', { beneficiary, payment, currency },
    'Failed to settle the beneficiary payout');
}
