/**
 * @file src/commerce/beneficiary-split.ts
 * @description THE SECOND RAKE. The platform rake (`marketplace-fee.ts`) takes a percent of what the
 *   CONSUMER pays and routes it to one operator account. This takes a percent of what the PROVIDER
 *   earns and routes it to N beneficiary GHIIs who are neither the consumer nor the seller.
 *
 *   Same shape, different pocket — and the pocket is the whole point. A share carved out of the
 *   consumer's charge would invent a contract the consumer never signed: they bought one thing from
 *   one seller, and billing them a second obligation to a stranger is both a surprise and the wrong
 *   VAT chain. A share carved out of the PROVIDER's own cut is the provider giving away their own
 *   revenue, which needs nobody's permission but theirs. That is why this can exist at all without
 *   the node holding anyone's money: at no instant does AIMEAT stand between the two parties.
 *
 *   TWO SOURCES, ONE POOL. `poolPercent` and the static rows are server-held provider configuration,
 *   written through an authenticated owner route and never readable from a request body. A capability
 *   may additionally name beneficiaries PER CALL (`dynamic`), because who deserves a share often
 *   depends on what the call was about — but it names only DESTINATIONS. The size of the pool stays
 *   config, so a capability can redirect a share the provider already committed and can never enlarge
 *   its own payout.
 *
 *   ROUNDING. The pool FLOORS (`percentCut`), so the provider keeps the remainder and never pays out
 *   more than the percent they declared; the pool then divides by LARGEST REMAINDER, so the lines sum
 *   to the pool exactly at any amount. Composed with the ceiling platform fee this gives
 *   `price === platformFee + providerNet + Σ lines` by construction, because every step subtracts from
 *   what the step before it left.
 * @structure BeneficiaryShare · BeneficiarySplit · DynamicDesignation · SplitLine · SplitResult ·
 *   computeSplit · splitKey · readSplit · listSplitsByProvider · putSplit · deleteSplit
 * @usage
 *   const split = await readSplit(storage, providerGhii, ext, action);
 *   const { pool, lines, providerNet } = computeSplit(providerGross, split, designations);
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial: multi-beneficiary revenue splitting on the metered settlement path.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { percentCut } from './money.js';

/** System namespace — provider configuration the server trusts, so never in a principal's own space. */
export const NS_BENEFICIARY_SPLIT = 'beneficiary-split';

/** How many beneficiary rows one split may carry, static and dynamic together. */
export const BENEFICIARIES_MAX = 32;

/** One party entitled to a slice of the pool, and how large a slice relative to the others. */
export interface BeneficiaryShare {
  /** The beneficiary's owner GHII. Not a bare name — the book and the wallet are keyed on the GHII. */
  ghii: string;
  /** Relative weight within the pool. Two rows at weight 1 split it evenly; 3 and 1 split it 75/25. */
  weight: number;
  /** Free text the provider recorded, surfaced to the beneficiary beside the amount. */
  note: string;
}

/** A beneficiary a capability named for ONE call. Carries no amount and no percent — only a destination. */
export interface DynamicDesignation {
  ghii: string;
  weight?: number;
  note?: string;
  /** In `roles` mode, WHICH role this account is filling for this call. Ignored in `pool` mode. */
  role?: string;
}

/**
 * One role in a value chain, with its OWN percent of the provider's cut.
 *
 * A role is not a slice of a shared pot: the distributor's 10 % does not shrink because a label was
 * added. That is the difference between a chain and a pool, and it is why the two are separate modes
 * rather than one clever formula — a company told "you get 40 %" must not find out it meant 40 % of
 * whatever is left after everybody else.
 *
 * `ghii: null` means the role exists but nobody is holding it on this call. Its percent stays with
 * the provider: there is no account to pay, so there is nothing to pay. The capability may fill it
 * per call by naming the account for that role.
 */
export interface BeneficiaryRole {
  /** The role's name, e.g. `muusikko`. What a listing shows and what a capability fills by name. */
  role: string;
  /** 0–100 of the provider's cut. Independent of every other role. */
  percent: number;
  /** Filled statically, or null to be filled per call. */
  ghii: string | null;
  note: string;
}

/** The provider's declared split for one metered coordinate. */
export interface BeneficiarySplit {
  splitId: string;
  /** Whose revenue is being shared. Only this owner may write or release against it. */
  providerGhii: string;
  /** The metered coordinate, the same `(ext, action)` pair the entitlement is keyed on. */
  ext: string;
  action: string;
  capabilityLabel: string;
  /**
   * How the cut is divided.
   *   `pool`  — one percentage of the provider's cut, divided between beneficiaries by weight. Right
   *             when there is one thing to share and the sharers split it: adding a beneficiary
   *             dilutes the others, because the buyer paid once.
   *   `roles` — named roles, each with its OWN percent, all paid on every sale. Right for a value
   *             chain: distributor, performer, label, marketplace. Nobody dilutes anybody.
   */
  mode: 'pool' | 'roles';
  /** `pool` mode: 0–100 of the provider's cut that leaves them. Ignored in `roles` mode. */
  poolPercent: number;
  /** `roles` mode: the chain. Their percents are independent and must total at most 100. */
  roles: BeneficiaryRole[];
  /** Beneficiaries that share every call at this coordinate. May be empty when the split is dynamic. */
  beneficiaries: BeneficiaryShare[];
  /** Whether the capability may name additional beneficiaries per call. */
  dynamic: boolean;
  /** `paused` keeps the record and its history while sending the whole cut back to the provider. */
  state: 'active' | 'paused';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** One beneficiary's share of one call. */
export interface SplitLine {
  ghii: string;
  amount: number;
  weight: number;
  kind: 'static' | 'dynamic';
  note: string;
  /** In `roles` mode, which role earned this. Absent in `pool` mode. */
  role?: string;
}

/** What one call's revenue divides into, below the platform rake. */
export interface SplitResult {
  /** The whole amount carved out of the provider's cut. Equals the sum of `lines` exactly. */
  pool: number;
  lines: SplitLine[];
  /** What is left for the provider — the residual, so nothing is created or destroyed. */
  providerNet: number;
}

/**
 * Divide one call's provider cut between the provider and their beneficiaries.
 *
 * Pure: no storage, no clock, no config lookup — which is what lets the rounding invariant be proven
 * over adversarial amounts in a unit test rather than inferred from a settled ledger.
 *
 * With no rows the pool is ZERO and the provider keeps everything. That is the honest default for a
 * dynamic split whose call designated nobody: the share was never anyone else's until a beneficiary
 * existed to receive it, and parking it somewhere would be inventing a creditor.
 */
export function computeSplit(
  providerGross: number,
  split: BeneficiarySplit | null,
  designations: DynamicDesignation[] = [],
): SplitResult {
  const gross = Math.max(0, Math.floor(providerGross));
  const none: SplitResult = { pool: 0, lines: [], providerNet: gross };
  if (!split || split.state !== 'active' || gross <= 0) return none;

  // Roles first: a chain carries no pool at all, so the pool check below would send every chain home
  // empty. That is exactly what it did until an end-to-end sale caught it — the unit tests could not,
  // because their fixture happened to leave a pool percent set on a chain that never reads one.
  if (split.mode === 'roles') return divideByRoles(gross, split, designations);
  if (split.poolPercent <= 0) return none;

  const rows = mergeRows(split, designations);
  if (!rows.length) return none;

  const pool = percentCut(gross, Math.min(100, split.poolPercent));
  if (pool <= 0) return none;

  return { pool, lines: divide(pool, rows), providerNet: gross - pool };
}

/**
 * Pay each filled role its OWN percent of the provider's cut.
 *
 * No pool and no largest-remainder pass, because these are not shares of one amount: each percent
 * floors on its own and the rounding residue stays with the provider, which is the only party whose
 * share is defined as "whatever is left". Conservation still holds — the percents total at most 100
 * and every line floors — so the lines can never exceed the cut.
 *
 * An unfilled role contributes nothing and costs nothing. That is deliberate: a chain missing its
 * label should pay the label's percent to nobody rather than quietly redistributing it to the
 * others, who agreed to their own number and not to a share of somebody's absence.
 */
function divideByRoles(
  gross: number, split: BeneficiarySplit, designations: DynamicDesignation[],
): SplitResult {
  // Who holds which role on THIS call. A per-call filling wins over the standing one, so a chain can
  // name the performer for this track without rewriting its declaration.
  const filled = new Map<string, { ghii: string; kind: 'static' | 'dynamic'; note: string }>();
  for (const r of split.roles) {
    if (r.ghii) filled.set(r.role, { ghii: r.ghii, kind: 'static', note: r.note ?? '' });
  }
  if (split.dynamic) {
    for (const d of designations) {
      if (!d.role || !d.ghii) continue;
      filled.set(d.role, { ghii: d.ghii, kind: 'dynamic', note: (d.note ?? '').slice(0, 200) });
    }
  }

  const lines: SplitLine[] = [];
  for (const r of split.roles) {
    const who = filled.get(r.role);
    if (!who) continue;                                   // nobody holds it; the percent stays put
    const amount = percentCut(gross, Math.min(100, Math.max(0, r.percent)));
    if (amount <= 0) continue;
    lines.push({ ghii: who.ghii, amount, weight: r.percent, kind: who.kind, note: who.note, role: r.role });
  }
  const paid = lines.reduce((sum, l) => sum + l.amount, 0);
  return { pool: paid, lines, providerNet: gross - paid };
}

/** The row set for one call: the declared beneficiaries, plus this call's designations if allowed. */
function mergeRows(split: BeneficiarySplit, designations: DynamicDesignation[]): SplitLine[] {
  const byGhii = new Map<string, SplitLine>();
  const add = (ghii: string, weight: number, kind: 'static' | 'dynamic', note: string): void => {
    const w = Number.isFinite(weight) ? Math.max(0, weight) : 0;
    if (!ghii || w <= 0) return;
    const existing = byGhii.get(ghii);
    // The same party named both ways is one creditor with one claim, not two lines to reconcile.
    if (existing) { existing.weight += w; return; }
    if (byGhii.size >= BENEFICIARIES_MAX) return;
    byGhii.set(ghii, { ghii, amount: 0, weight: w, kind, note });
  };

  for (const b of split.beneficiaries) add(b.ghii, b.weight, 'static', b.note ?? '');
  if (split.dynamic) for (const d of designations) add(d.ghii, d.weight ?? 1, 'dynamic', (d.note ?? '').slice(0, 200));
  return [...byGhii.values()];
}

/**
 * Split `pool` across weighted rows by LARGEST REMAINDER, so the lines sum to the pool exactly.
 *
 * Floor every share, then hand the leftover units out one at a time to whoever lost the most to the
 * floor. Proportional division of integers cannot be exact for every input, so the only question is
 * where the error goes — and "nowhere" is the answer a ledger needs. Ties break on the earlier row so
 * the result is deterministic and a replay of the same call reproduces the same allocation.
 */
function divide(pool: number, rows: SplitLine[]): SplitLine[] {
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight <= 0) return [];

  const scaled = rows.map((row, index) => {
    const exact = (pool * row.weight) / totalWeight;
    const base = Math.floor(exact);
    return { row, index, base, remainder: exact - base };
  });

  let left = pool - scaled.reduce((sum, s) => sum + s.base, 0);
  const order = [...scaled].sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
  for (const s of order) {
    if (left <= 0) break;
    s.base += 1;
    left -= 1;
  }

  return scaled.map(s => ({ ...s.row, amount: s.base })).filter(l => l.amount > 0);
}

/** Deterministic key for a `(provider, ext, action)` coordinate — GHII holds `@`/`#`, so hash it. */
export function splitKey(providerGhii: string, ext: string, action: string): string {
  return `bensplit.${createHash('sha256').update(`${providerGhii}|${ext}|${action}`).digest('hex').slice(0, 32)}`;
}

/** The split in force for a coordinate, or null when the provider declared none. */
export async function readSplit(
  storage: Storage, providerGhii: string, ext: string, action: string,
): Promise<BeneficiarySplit | null> {
  const rec = await storage.getMemory(NS_BENEFICIARY_SPLIT, splitKey(providerGhii, ext, action));
  return rec ? (rec.value as BeneficiarySplit) : null;
}

/** Every split a provider has declared — the "what am I sharing, and with whom" surface. */
export async function listSplitsByProvider(storage: Storage, providerGhii: string): Promise<BeneficiarySplit[]> {
  const { items } = await storage.listAllMemory({ prefix: 'bensplit.', limit: 5000 });
  return items
    .map(r => r.value as BeneficiarySplit)
    .filter(v => v && v.providerGhii === providerGhii)
    .sort((a, b) => a.capabilityLabel.localeCompare(b.capabilityLabel));
}

/** Declare (or replace) a split. The caller has already established that `providerGhii` is the writer. */
export async function putSplit(
  storage: Storage,
  input: {
    providerGhii: string; ext: string; action: string; capabilityLabel?: string;
    mode?: 'pool' | 'roles';
    poolPercent?: number; beneficiaries?: BeneficiaryShare[];
    roles?: BeneficiaryRole[];
    dynamic?: boolean; state?: 'active' | 'paused'; createdBy: string;
  },
): Promise<BeneficiarySplit> {
  const now = new Date().toISOString();
  const prev = await readSplit(storage, input.providerGhii, input.ext, input.action);
  const value: BeneficiarySplit = {
    splitId: prev?.splitId || randomUUID(),
    providerGhii: input.providerGhii,
    ext: input.ext,
    action: input.action,
    capabilityLabel: input.capabilityLabel || `${input.ext}/${input.action}`,
    mode: input.mode ?? 'pool',
    poolPercent: clampPercent(input.poolPercent ?? 0),
    roles: (input.roles ?? []).slice(0, BENEFICIARIES_MAX).map(r => ({
      role: r.role,
      percent: clampPercent(r.percent),
      ghii: r.ghii || null,
      note: (r.note ?? '').slice(0, 200),
    })),
    beneficiaries: (input.beneficiaries ?? []).slice(0, BENEFICIARIES_MAX).map(b => ({
      ghii: b.ghii,
      weight: Number.isFinite(b.weight) ? Math.max(0, b.weight) : 0,
      note: (b.note ?? '').slice(0, 200),
    })),
    dynamic: input.dynamic ?? false,
    state: input.state ?? 'active',
    createdAt: prev?.createdAt || now,
    createdBy: prev?.createdBy || input.createdBy,
    updatedAt: now,
  };
  await storage.setMemory({
    key: splitKey(value.providerGhii, value.ext, value.action),
    ownerGaii: NS_BENEFICIARY_SPLIT,
    value,
    visibility: 'private',
    tags: ['beneficiary-split'],
    ttlHours: null,
    version: 1,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
  return value;
}

/** Withdraw a split entirely. Already-accrued entries survive — what was earned does not un-happen. */
export async function deleteSplit(
  storage: Storage, providerGhii: string, ext: string, action: string,
): Promise<boolean> {
  if (!await readSplit(storage, providerGhii, ext, action)) return false;
  await storage.deleteMemory(NS_BENEFICIARY_SPLIT, splitKey(providerGhii, ext, action));
  return true;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
