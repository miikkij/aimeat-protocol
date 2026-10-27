/**
 * @file src/routes/commerce-beneficiaries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST surface for beneficiary revenue splitting — declaring who shares a
 *   capability's earnings, reading what has accrued to whom, and releasing it.
 *
 *   FOUR AUDIENCES, FOUR AUTHORISATIONS, and they are deliberately not the same:
 *     - the PROVIDER declares splits and releases shares, against their own resolved identity only;
 *     - the BENEFICIARY reads what they are owed, and only their own;
 *     - the OPERATOR records verification approvals, because a payout gate a provider could open for
 *       themselves is not a gate;
 *     - nobody at all sets a share from a request body on the call path — `poolPercent` is read from
 *       the server-held split on every settlement, never from anything a client sent.
 *
 *   Every ownership comparison here is against `resolveIdentity(req.auth!, config.nodeId)` and never
 *   `req.auth!.sub`, so an owner's agent and a granted app act on the OWNER's splits and nobody
 *   reaches across an account boundary.
 * @structure commerceBeneficiariesRouter — POST/GET/DELETE /v1/commerce/beneficiary-splits ·
 *   GET /v1/commerce/beneficiary/earnings · GET /v1/commerce/beneficiary/obligations ·
 *   POST /v1/commerce/beneficiary/release · GET+POST /v1/commerce/beneficiary/approvals
 * @usage app.use(commerceBeneficiariesRouter(config, storage));
 * @version-history
 *   2026-10-27 — POST /v1/commerce/beneficiary/payout answers 502 X402_SETTLE_UNKNOWN when the settle did
 *     not answer and takes possible_payment_not_arrived; the quote lists possible_payments
 *     (secaudit2026oct26, commerce/beneficiary-payout:settle-error-unrecorded-possible-payment).
 *   2026-10-25 — DELETE /v1/commerce/beneficiary-splits reaches a split on the provider's own extension by its short name too (withdrawSplit), since the split is keyed `<owner>/<name>` (secaudit2026oct22).
 *   2026-10-16 — earnings and obligations total every entry and return the newest `limit` of them, with
 *     `total` beside `count`; the totals were sums of a window (QA audit S8-10).
 *   2026-10-16 — POST /v1/commerce/beneficiary-splits calls declareSplit and both split routes answer
 *     with splitView (commerce/beneficiary-split-declare.ts), which aimeat_commerce_beneficiary_split_set
 *     uses too; a split now names its author, `created_by` (QA audit D2-08).
 *   v1.2.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): wallet:read on GET /v1/commerce/beneficiary/approvals. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   v1.1.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail. The operator routes ask requireOperator (askOperator with operator:admin) (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-07-30 — Initial: declare / read / release / approve for the second rake.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { listSplitsByProvider } from '../commerce/beneficiary-split.js';
import { declareSplit, splitView, withdrawSplit } from '../commerce/beneficiary-split-declare.js';
import {
  listBeneficiaryEntries, listBeneficiaryObligations, totalsOf, type BeneficiaryEntry,
} from '../commerce/beneficiary-book.js';
import {
  readApproval, putApproval, beneficiaryEligibility, releaseBeneficiaryShare,
} from '../commerce/beneficiary-release.js';
import { quoteBeneficiaryPayout, settleBeneficiaryPayout } from '../commerce/beneficiary-payout.js';
import type { X402PaymentPayload } from '../commerce/x402-facilitator.js';
import { operatorOverride } from '../services/operator-override.js';
import { requireRestScope } from '../auth/rest-scope-gate.js';

function entryView(e: BeneficiaryEntry & { trackingCode: string }): Record<string, unknown> {
  return {
    tracking_code: e.trackingCode,
    amount: e.amount,
    currency: e.currency,
    from: e.fromGhii,
    buyer: e.buyerGhii ?? null,
    reference: e.reference ?? null,
    weight: e.weight,
    kind: e.kind,
    note: e.note ?? null,
    status: e.status,
    released_at: e.releasedAt ?? null,
    release_method: e.releaseMethod ?? null,
    paid_at: e.paidAt ?? null,
    payout_rail: e.payoutRail ?? null,
    payout_reference: e.payoutReference ?? null,
    at: e.at,
  };
}

export function commerceBeneficiariesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── The provider's side: declaring who shares what ───────────────────────────

  /**
   * POST /v1/commerce/beneficiary-splits — declare (or replace) the split on one metered coordinate.
   *
   * The split is always written for the CALLER's own resolved owner. A provider cannot declare that
   * somebody else's capability shares its revenue, which is the whole cross-owner question here: the
   * money being given away has to be the giver's.
   */
  router.post('/v1/commerce/beneficiary-splits', requireAuth(), requireScope('exchange:beneficiary'), async (req: Request, res: Response) => {
    // The validation, the author and the write are commerce/beneficiary-split-declare.ts, which
    // aimeat_commerce_beneficiary_split_set calls too. The author is the calling principal.
    const principal = resolveIdentity(req.auth!, config.nodeId);
    const out = await declareSplit(storage, { providerGhii: ownerGhiiOf(principal), createdBy: principal },
      (req.body ?? {}) as Record<string, unknown>);
    if (!out.ok) return res.status(400).json(error(config.nodeId, out.code, out.message));

    return res.json(success(config.nodeId, {
      split: splitView(out.split),
      note: 'The pool is taken from YOUR cut, after the platform rake and never from the buyer\'s charge. '
        + 'Shares accrue on every settled call; releasing one needs the beneficiary to be verified.',
    }, [
      { description: 'What you now owe', method: 'GET', url: '/v1/commerce/beneficiary/obligations' },
    ]));
  });

  /** GET /v1/commerce/beneficiary-splits — every split the caller's owner has declared. */
  router.get('/v1/commerce/beneficiary-splits', requireAuth(), requireScope('exchange:beneficiary'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const splits = await listSplitsByProvider(storage, providerGhii);
    return res.json(success(config.nodeId, { splits: splits.map(splitView), count: splits.length }));
  });

  /** DELETE /v1/commerce/beneficiary-splits — withdraw one. Accrued shares are untouched by design. */
  router.delete('/v1/commerce/beneficiary-splits', requireAuth(), requireScope('exchange:beneficiary'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const ext = typeof req.query.ext === 'string' ? req.query.ext : '';
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    if (!ext || !action) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name the coordinate: ?ext=&action='));
    }
    const removed = await withdrawSplit(storage, providerGhii, ext, action);
    if (!removed) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'You have no split declared on that coordinate'));
    return res.json(success(config.nodeId, {
      removed: true,
      note: 'Future calls keep your whole cut. Shares already accrued still stand: what was earned does not un-happen.',
    }));
  });

  // ── The beneficiary's side: what am I owed ───────────────────────────────────

  /**
   * GET /v1/commerce/beneficiary/earnings — what the caller has been given a share of.
   *
   * Owner-scoped on the money identity, the same key the wallet and the payable book use, and gated
   * with `wallet:read` for non-owner principals: being handed someone's receivables and being handed
   * their balance are the same favour.
   */
  router.get('/v1/commerce/beneficiary/earnings', requireAuth(), requireScope('wallet:read'), async (req: Request, res: Response) => {
    const beneficiaryGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    // Totals over EVERY entry, the list capped at the newest `limit` (QA audit S8-10).
    const all = await listBeneficiaryEntries(storage, beneficiaryGhii);
    const matching = status ? all.filter(e => e.status === status) : all;
    const entries = matching.slice(0, limitOf(req.query.limit));
    const gate = await beneficiaryEligibility(storage, config, beneficiaryGhii);
    return res.json(success(config.nodeId, {
      beneficiary: beneficiaryGhii,
      verification: { state: gate.state, payable: gate.eligible, reason: gate.reason, message: gate.message },
      totals: totalsOf(matching),
      entries: entries.map(entryView),
      count: entries.length,
      total: matching.length,
      note: 'A share is owed by the PROVIDER, not by the buyer. It comes out of what the provider earned. '
        + '`accrued` means booked and unpaid; it becomes payable once your account is verified.',
    }));
  });

  /** GET /v1/commerce/beneficiary/obligations — what the caller OWES their beneficiaries. */
  router.get('/v1/commerce/beneficiary/obligations', requireAuth(), requireScope('wallet:read'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const all = await listBeneficiaryObligations(storage, providerGhii);
    const matching = status ? all.filter(e => e.status === status) : all;
    const entries = matching.slice(0, limitOf(req.query.limit, 1000));
    return res.json(success(config.nodeId, {
      provider: providerGhii,
      totals: totalsOf(matching),
      entries: entries.map(e => ({ ...entryView(e), beneficiary: e.beneficiaryGhii })),
      count: entries.length,
      total: matching.length,
    }, [
      { description: 'Release one', method: 'POST', url: '/v1/commerce/beneficiary/release' },
    ]));
  });

  /**
   * POST /v1/commerce/beneficiary/release — pay one accrued share.
   *
   * Only the PROVIDER who owes it may call this, and only for their own obligations: the release moves
   * value out of the caller's own account, so a caller who is not the debtor has nothing to release.
   * The verification gate is re-checked inside `releaseBeneficiaryShare` rather than trusted from here.
   */
  router.post('/v1/commerce/beneficiary/release', requireAuth(), requireScope('exchange:beneficiary'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const trackingCode = typeof body.tracking_code === 'string' ? body.tracking_code.trim() : '';
    const beneficiary = typeof body.beneficiary === 'string' ? body.beneficiary.trim() : '';
    if (!trackingCode || !beneficiary) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Name the share to release: `tracking_code` and `beneficiary` (both are on /beneficiary/obligations)'));
    }

    const result = await releaseBeneficiaryShare(storage, config, { providerGhii, beneficiaryGhii: beneficiary, trackingCode });
    if (!result.ok) {
      // An unverified beneficiary is a refusal to PAY, not a failure to find anything — 409, so it
      // reads as "this cannot happen yet" rather than "you got the id wrong".
      const status = result.reason === 'NOTHING_ACCRUED' ? 404 : 409;
      return res.status(status).json(error(config.nodeId, result.reason, result.message));
    }
    return res.json(success(config.nodeId, {
      released: true,
      beneficiary,
      tracking_code: trackingCode,
      amount: result.entry.amount,
      currency: result.entry.currency,
      method: result.method,
      note: 'Booked onto their payable book. The node moves no fiat, so the money itself moves '
        + 'when you sign for it at POST /v1/commerce/beneficiary/payout.',
    }));
  });

  // ── The operator's side: who may be paid at all ──────────────────────────────

  /**
   * POST /v1/commerce/beneficiary/approvals — record what was established about a beneficiary.
   *
   * OPERATOR ONLY. A provider approving their own payees would make the gate decorative, and the
   * point of the gate is that paying a party nobody has checked is how a self-declared claimant
   * collects on someone else's identity.
   */
  router.post('/v1/commerce/beneficiary/approvals', requireAuth(), requireOperator(storage), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ghii = typeof body.ghii === 'string' ? body.ghii.trim() : '';
    const state = body.state;
    if (!ghii || ghii.indexOf('@') < 1) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', '`ghii` must be an owner GHII (owner@node-id)'));
    }
    if (state !== 'verified' && state !== 'unverified' && state !== 'rejected') {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', '`state` must be verified, unverified or rejected'));
    }
    if (state === 'verified' && typeof body.method !== 'string') {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'A verification must say HOW representation was established. Set `method`, e.g. "suomifi-valtuudet"'));
    }
    const approval = await putApproval(storage, {
      ghii, state,
      method: typeof body.method === 'string' ? body.method : undefined,
      subject: typeof body.subject === 'string' ? body.subject : null,
      evidence: typeof body.evidence === 'string' ? body.evidence : undefined,
      verifiedBy: resolveIdentity(req.auth!, config.nodeId),
    });
    return res.json(success(config.nodeId, { approval }));
  });

  /** GET /v1/commerce/beneficiary/approvals — the caller's own approval state, or one named by an operator. */
  router.get('/v1/commerce/beneficiary/approvals', requireAuth(), requireRestScope('wallet:read'), async (req: Request, res: Response) => {
    const self = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const asked = typeof req.query.ghii === 'string' ? req.query.ghii : '';
    // Anyone may read their own; reading someone else's verification state is an operator question,
    // asked through operatorOverride (the operator, or the operator's agent holding operator:admin,
    // as on MCP), which writes the operator trail.
    if (asked && asked !== self && !(await operatorOverride(storage, config, req.auth,
      { ownerOf: asked, area: 'beneficiary', action: 'read', subject: 'approval' }))) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You may read your own approval state only'));
    }
    const ghii = asked || self;
    const approval = await readApproval(storage, ghii);
    const gate = await beneficiaryEligibility(storage, config, ghii);
    return res.json(success(config.nodeId, {
      ghii,
      approval,
      state: gate.state,
      payable: gate.eligible,
      message: gate.message,
    }));
  });

  // ── The last leg: money actually reaching them ───────────────────────────────

  /**
   * GET /v1/commerce/beneficiary/payout — what you still owe one beneficiary, and how to pay it.
   *
   * Returns the x402 exact-scheme requirements for the provider to SIGN. The node orchestrates and
   * holds nothing: neither money handler can push a provider's funds to a third party (Stripe has no
   * Connect platform here by design, and x402's own payout leg is a no-op because the money moved
   * buyer-to-seller at collect time), so a provider-to-beneficiary transfer is a different payment
   * that its payer has to authorise.
   *
   * AGGREGATED across every released-and-unpaid entry in one currency: a share is a fraction of a
   * sub-euro call, and one signature clearing the whole balance is both cheaper than the gas on each
   * and closer to how an invoice period actually works.
   */
  router.get('/v1/commerce/beneficiary/payout', requireAuth(), requireScope('wallet:read'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const beneficiary = typeof req.query.beneficiary === 'string' ? req.query.beneficiary.trim() : '';
    if (!beneficiary) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Name the beneficiary: ?beneficiary=owner@node-id'));
    }
    const currency = typeof req.query.currency === 'string' ? req.query.currency : undefined;
    const q = await quoteBeneficiaryPayout(storage, config, { providerGhii, beneficiaryGhii: beneficiary, currency });
    return res.json(success(config.nodeId, {
      payable: q.ok,
      reason: q.ok ? null : q.reason,
      message: q.message ?? null,
      beneficiary,
      amount: q.amount,
      currency: q.currency,
      entries: q.entries.length,
      pay_to: q.payTo ?? null,
      accepts: q.requirements ? [q.requirements] : [],
      ...(q.possiblePayments ? { possible_payments: q.possiblePayments } : {}),
      note: q.ok
        ? 'Sign these requirements with the wallet that holds the funds and POST the signed payload '
          + 'back here. The node never holds the money: it settles from your address into theirs.'
        : null,
    }));
  });

  /**
   * POST /v1/commerce/beneficiary/payout — settle it with the provider's signed authorisation.
   *
   * The quote is rebuilt server-side rather than trusted from the body, so a signature can only move
   * what is genuinely owed at this instant. Entries flip to `paid` only after the facilitator
   * confirms, so a failed settlement leaves them payable rather than recording a delivery that did
   * not happen.
   */
  router.post('/v1/commerce/beneficiary/payout', requireAuth(), requireScope('exchange:beneficiary'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const beneficiary = typeof body.beneficiary === 'string' ? body.beneficiary.trim() : '';
    const notArrived = typeof body.possible_payment_not_arrived === 'string' ? body.possible_payment_not_arrived.trim() : '';
    if (!beneficiary || (!body.payment && !notArrived)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Send `beneficiary` and the signed `payment` payload from GET /v1/commerce/beneficiary/payout'));
    }
    const r = await settleBeneficiaryPayout(storage, config, {
      providerGhii, beneficiaryGhii: beneficiary,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      ...(notArrived ? { notArrivedNonce: notArrived } : { payload: body.payment as X402PaymentPayload }),
    });
    if (!r.ok) {
      const status = r.reason === 'NOTHING_OWED' || r.reason === 'NOT_FOUND' ? 404
        : r.reason === 'BENEFICIARY_NO_ADDRESS' || r.reason === 'POSSIBLE_PAYMENT_OPEN' ? 409
        : r.reason === 'X402_SETTLE_UNKNOWN' ? 502
        : r.reason === 'PAYMENT_REQUIRED' ? 402 : 422;
      return res.status(status).json(error(config.nodeId, r.reason, r.message));
    }
    if ('closed' in r) {
      return res.json(success(config.nodeId, {
        closed: true, beneficiary, nonce: r.nonce, amount: r.amount, currency: r.currency,
        note: 'The possible payout is closed as not arrived. Its entries are in the next quote again.',
      }));
    }
    return res.json(success(config.nodeId, {
      paid: true, beneficiary, amount: r.amount, currency: r.currency,
      entries: r.entries, tx_hash: r.txHash, pay_to: r.payTo,
      note: 'Settled onchain from your address into theirs. The node held nothing at any point; the '
        + 'transaction hash is the proof, and those entries now read `paid`.',
    }));
  });

  return router;
}

/** Clamp a `?limit=` to something a scan can serve, defaulting when it is absent or nonsense. */
function limitOf(raw: unknown, fallback = 200): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : fallback;
}
