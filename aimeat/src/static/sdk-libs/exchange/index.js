/**
 * @file exchange/index.js
 * @description The aimeat-exchange library (NOSTE prompt 02, gap G19). Exposes AIMEAT.exchange — the
 *   EXCHANGE marketplace from a BROWSER: browse and search listings, publish and manage your own,
 *   read who is using them and what they have consumed, accept and switch off contracts, see what
 *   you have spent and what you are owed, and work the demand side (needs and bids).
 *
 *   Until this existed the whole market was reachable only over REST-by-hand or by having an agent
 *   drive MCP, which fits agent flows and fits nothing a human does in a page. Every selling app
 *   needs this, which is why it is node core rather than an app-side helper.
 *
 *   SCOPE BOUNDARY. aimeat-commerce owns BUYING and money FORMATTING — checkout sessions, the 402
 *   `accepts` surface, app-tool manifests, `fmtMoney`/`fmtAmount`/`MONEY_UNIT`. None of that is
 *   restated here: this library depends on it for money rendering and defers to it for checkout,
 *   and adds the market side — supply, listings, contracts, lineage, earnings.
 *
 *   SECURITY. It carries no secrets and asks for none. Seller payment credentials are server-side
 *   and never readable. Authorisation is the server's job throughout: this sends the aimeat-auth
 *   session and renders what comes back — it never decides who may see what.
 * @structure imports the group modules (browse · sell · contracts · earnings · beneficiaries ·
 *   demand · format · odps-completeness), composes the AIMEAT.exchange surface, attaches it via
 *   _core/namespace.
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-commerce.js"></script>
 *   <script src="/v1/libs/aimeat-exchange.js"></script>
 *   const { offerings } = await AIMEAT.exchange.list({ q: 'company' });
 *   const contract = await AIMEAT.exchange.accept(offerings[0].offeringId, { capUnits: 500 });
 * @version-history
 *   v1.1.0 — 2026-07-30 — The second rake: declare who shares what a capability earns, read what you
 *     are owed and what you owe, release a share, and see the verification that gates a payout.
 *   v1.0.0 — 2026-07-28 — Initial: the EXCHANGE browser library (NOSTE prompt 02 / requirements R-K3).
 */
import { attach } from '../_core/namespace.js';
import { info, list, search, get, odps, odpsYaml } from './browse.js';
import {
  publish, update, delist, stats, consumers, reconcile, providerHistory,
  grants, grant, revokeGrant,
} from './sell.js';
import {
  contracts, accept, off, history, spend, coordinateOf,
  proposals, propose, acceptProposal, declineProposal, withdrawProposal,
  startWork, deliverWork, work,
} from './contracts.js';
import { earnings } from './earnings.js';
import {
  declareSplit, splits, deleteSplit, obligations, release, approval, approve,
  payoutQuote, payout, earnings as beneficiaryEarnings,
} from './beneficiaries.js';
import { needs, postNeed, closeNeed, bids, bid, acceptBid } from './demand.js';
import { fmtUnit, fmtMorsels } from './format.js';
import { odpsCompleteness, ODPS_AUTHORED_FIELDS } from './odps-completeness.js';

const exchange = {
  // ── Browsing (public where the route is public) ──
  info, list, search, get, odps, odpsYaml,

  // ── Selling ──
  publish, update, delist, stats, consumers, reconcile, providerHistory,
  grants, grant, revokeGrant,

  // ── Buying + contracts ──
  contracts, accept, off, history, spend, coordinateOf,
  proposals, propose, acceptProposal, declineProposal, withdrawProposal,
  startWork, deliverWork, work,

  // ── Earnings (read-only: the accrual, not a payout) ──
  earnings,

  // ── Revenue you SHARE (the second rake — out of the seller's cut, never the buyer's charge) ──
  declareSplit, splits, deleteSplit, obligations, release, approval, approve,
  payoutQuote, payout, beneficiaryEarnings,

  // ── Demand ──
  needs, postNeed, closeNeed, bids, bid, acceptBid,

  // ── Helpers ──
  fmtUnit, fmtMorsels, odpsCompleteness, ODPS_AUTHORED_FIELDS,
};

attach('exchange', exchange);
