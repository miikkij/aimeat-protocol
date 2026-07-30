/**
 * @file src/routes/commerce-beneficiaries.ts
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
 *   v1.0.0 — 2026-07-30 — Initial: declare / read / release / approve for the second rake.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import {
  putSplit, deleteSplit, listSplitsByProvider,
  BENEFICIARIES_MAX, type BeneficiarySplit, type BeneficiaryShare, type BeneficiaryRole,
} from '../commerce/beneficiary-split.js';
import {
  listBeneficiaryEntries, listBeneficiaryObligations, type BeneficiaryEntry,
} from '../commerce/beneficiary-book.js';
import {
  readApproval, putApproval, beneficiaryEligibility, releaseBeneficiaryShare,
} from '../commerce/beneficiary-release.js';
import { quoteBeneficiaryPayout, settleBeneficiaryPayout } from '../commerce/beneficiary-payout.js';
import type { X402PaymentPayload } from '../commerce/x402-facilitator.js';

/** What a split looks like on the wire. Snake-case, like every other commerce surface. */
function splitView(s: BeneficiarySplit): Record<string, unknown> {
  return {
    split_id: s.splitId,
    provider: s.providerGhii,
    ext: s.ext,
    action: s.action,
    capability: s.capabilityLabel,
    mode: s.mode,
    pool_percent: s.poolPercent,
    roles: s.roles.map(r => ({ role: r.role, percent: r.percent, ghii: r.ghii, note: r.note })),
    /** One line a listing can show without the reader working it out. */
    arrangement: describeSplit(s),
    dynamic: s.dynamic,
    state: s.state,
    beneficiaries: s.beneficiaries.map(b => ({ ghii: b.ghii, weight: b.weight, note: b.note })),
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

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

/** Sum the entries into the headline the reader actually wants, split by status and by unit. */
function totalsOf(entries: Array<BeneficiaryEntry & { trackingCode: string }>): Record<string, unknown> {
  const totals: Record<string, { accrued: number; released: number; paid: number; reversed: number; entries: number }> = {};
  for (const e of entries) {
    // Keyed by currency. There is no morsel bucket: morsels pace usage and are never shared.
    const bucket = e.currency;
    const t = totals[bucket] ?? (totals[bucket] = { accrued: 0, released: 0, paid: 0, reversed: 0, entries: 0 });
    t[e.status] += e.amount;
    t.entries += 1;
  }
  return totals;
}

/**
 * The arrangement in one sentence, derived from the record settlement actually reads.
 *
 * Derived rather than authored, so a listing cannot advertise a split the node would not honour. A
 * seller writing their own sentence here would be marketing; this is a description.
 */
function describeSplit(s: BeneficiarySplit): string {
  if (s.state !== 'active') return 'No revenue is shared at present.';
  if (s.mode === 'roles') {
    const named = s.roles.map(r => `${r.role} ${r.percent} %`).join(', ');
    const open = s.roles.filter(r => !r.ghii).length;
    return named
      ? `${s.roles.length} roles, each paid its own share of the seller's revenue: ${named}.`
        + (open ? ` ${open} of them are filled per sale.` : '')
      : 'A role chain with no roles declared.';
  }
  if (s.poolPercent <= 0) return 'No revenue is shared at present.';
  if (s.dynamic && !s.beneficiaries.length) {
    return `${s.poolPercent} % of the seller's revenue is shared with the accounts each sale names.`;
  }
  const n = s.beneficiaries.length;
  const weights = s.beneficiaries.map(b => b.weight).join(':');
  return `${s.poolPercent} % of the seller's revenue is shared between ${n} account${n === 1 ? '' : 's'}`
    + (n > 1 ? ` in the ratio ${weights}` : '')
    + (s.dynamic ? ', plus any the sale itself names' : '') + '.';
}

/** Parse and validate the role rows. A chain that promises more than exists is refused outright. */
function parseRoles(raw: unknown): { rows: BeneficiaryRole[] } | { bad: string } {
  if (raw === undefined || raw === null) return { rows: [] };
  if (!Array.isArray(raw)) return { bad: '`roles` must be an array' };
  if (raw.length > BENEFICIARIES_MAX) return { bad: `At most ${BENEFICIARIES_MAX} roles per split` };
  const rows: BeneficiaryRole[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { bad: 'Each role must be an object' };
    const { role, percent, ghii, note } = item as Record<string, unknown>;
    if (typeof role !== 'string' || !role.trim()) return { bad: 'Each role needs a `role` name' };
    if (seen.has(role)) return { bad: `Role "${role}" is declared twice` };
    seen.add(role);
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { bad: `Role "${role}" needs a \`percent\` between 0 and 100` };
    }
    if (ghii !== undefined && ghii !== null && (typeof ghii !== 'string' || ghii.indexOf('@') < 1)) {
      return { bad: `Role "${role}" has a \`ghii\` that is not an owner GHII` };
    }
    rows.push({ role: role.trim(), percent: pct, ghii: (ghii as string) ?? null, note: typeof note === 'string' ? note : '' });
  }
  const total = rows.reduce((sum, r) => sum + r.percent, 0);
  if (total > 100) {
    return { bad: `The roles total ${total} % of your cut, which is more than you receive. `
      + 'Each role takes its own percent independently, so they must total at most 100.' };
  }
  return { rows };
}

/** Parse and validate the beneficiary rows off a request body. Rejects rather than silently dropping. */
function parseBeneficiaries(raw: unknown): { rows: BeneficiaryShare[] } | { bad: string } {
  if (raw === undefined || raw === null) return { rows: [] };
  if (!Array.isArray(raw)) return { bad: '`beneficiaries` must be an array' };
  if (raw.length > BENEFICIARIES_MAX) return { bad: `At most ${BENEFICIARIES_MAX} beneficiaries per split` };
  const rows: BeneficiaryShare[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { bad: 'Each beneficiary must be an object' };
    const { ghii, weight, note } = item as Record<string, unknown>;
    if (typeof ghii !== 'string' || ghii.indexOf('@') < 1) {
      return { bad: 'Each beneficiary needs a `ghii` in the form owner@node-id' };
    }
    const w = weight === undefined ? 1 : Number(weight);
    if (!Number.isFinite(w) || w <= 0) return { bad: `Weight for ${ghii} must be a positive number` };
    rows.push({ ghii, weight: w, note: typeof note === 'string' ? note : '' });
  }
  return { rows };
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
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ext = typeof body.ext === 'string' ? body.ext.trim() : '';
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!ext || !action) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Name the metered coordinate this split applies to: `ext` and `action`'));
    }

    const mode = body.mode === 'roles' ? 'roles' : 'pool';
    const dynamic = body.dynamic === true;

    const roles = parseRoles(body.roles);
    if ('bad' in roles) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', roles.bad));
    const parsed = parseBeneficiaries(body.beneficiaries);
    if ('bad' in parsed) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.bad));

    let pool = 0;
    if (mode === 'roles') {
      if (!roles.rows.length) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'A role chain needs at least one role. Each role takes its own percent of your cut and they '
          + 'total at most 100; an unfilled role simply pays nobody.'));
      }
    } else {
      pool = Number(body.pool_percent);
      if (!Number.isFinite(pool) || pool < 0 || pool > 100) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          '`pool_percent` is the share of YOUR cut that goes to beneficiaries, 0-100'));
      }
      if (!parsed.rows.length && !dynamic) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'A split with no beneficiaries and no `dynamic: true` would divide nothing. Either list who '
          + 'shares it, or set `dynamic: true` so the capability may name them per call.'));
      }
    }

    const split = await putSplit(storage, {
      providerGhii, ext, action,
      capabilityLabel: typeof body.capability === 'string' ? body.capability : undefined,
      mode, poolPercent: pool, beneficiaries: parsed.rows, roles: roles.rows, dynamic,
      state: body.state === 'paused' ? 'paused' : 'active',
      createdBy: resolveIdentity(req.auth!, config.nodeId),
    });

    return res.json(success(config.nodeId, {
      split: splitView(split),
      note: 'The pool is taken from YOUR cut, after the platform rake and never from the buyer\'s charge. '
        + 'Shares accrue on every settled call; releasing one needs the beneficiary to be verified.',
    }, [
      { description: 'What you now owe', method: 'GET', url: '/v1/commerce/beneficiary/obligations' },
    ]));
  });

  /** GET /v1/commerce/beneficiary-splits — every split the caller's owner has declared. */
  router.get('/v1/commerce/beneficiary-splits', requireAuth(), async (req: Request, res: Response) => {
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
    const removed = await deleteSplit(storage, providerGhii, ext, action);
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
    const all = await listBeneficiaryEntries(storage, beneficiaryGhii, limitOf(req.query.limit));
    const entries = status ? all.filter(e => e.status === status) : all;
    const gate = await beneficiaryEligibility(storage, config, beneficiaryGhii);
    return res.json(success(config.nodeId, {
      beneficiary: beneficiaryGhii,
      verification: { state: gate.state, payable: gate.eligible, reason: gate.reason, message: gate.message },
      totals: totalsOf(entries),
      entries: entries.map(entryView),
      count: entries.length,
      note: 'A share is owed by the PROVIDER, not by the buyer. It comes out of what the provider earned. '
        + '`accrued` means booked and unpaid; it becomes payable once your account is verified.',
    }));
  });

  /** GET /v1/commerce/beneficiary/obligations — what the caller OWES their beneficiaries. */
  router.get('/v1/commerce/beneficiary/obligations', requireAuth(), requireScope('wallet:read'), async (req: Request, res: Response) => {
    const providerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const all = await listBeneficiaryObligations(storage, providerGhii, limitOf(req.query.limit, 1000));
    const entries = status ? all.filter(e => e.status === status) : all;
    return res.json(success(config.nodeId, {
      provider: providerGhii,
      totals: totalsOf(entries),
      entries: entries.map(e => ({ ...entryView(e), beneficiary: e.beneficiaryGhii })),
      count: entries.length,
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
  router.post('/v1/commerce/beneficiary/approvals', requireAuth(), requireRole('operator'), async (req: Request, res: Response) => {
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
  router.get('/v1/commerce/beneficiary/approvals', requireAuth(), async (req: Request, res: Response) => {
    const self = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const asked = typeof req.query.ghii === 'string' ? req.query.ghii : '';
    // Anyone may read their own; reading someone else's verification state is an operator question.
    if (asked && asked !== self && !req.auth!.roles.includes('operator')) {
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
    if (!beneficiary || !body.payment) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Send `beneficiary` and the signed `payment` payload from GET /v1/commerce/beneficiary/payout'));
    }
    const r = await settleBeneficiaryPayout(storage, config, {
      providerGhii, beneficiaryGhii: beneficiary,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      payload: body.payment as X402PaymentPayload,
    });
    if (!r.ok) {
      const status = r.reason === 'NOTHING_OWED' ? 404
        : r.reason === 'BENEFICIARY_NO_ADDRESS' ? 409
        : r.reason === 'PAYMENT_REQUIRED' ? 402 : 422;
      return res.status(status).json(error(config.nodeId, r.reason, r.message));
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
