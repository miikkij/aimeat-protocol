/**
 * @file src/commerce/beneficiary-split-declare.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Declaring a beneficiary split from what a caller sent: the validation, the author and
 *   the write, for POST /v1/commerce/beneficiary-splits and the node MCP tool
 *   aimeat_commerce_beneficiary_split_set. Also the one wire view of a split (splitView), which
 *   names its author.
 *
 *   The split is always written for the caller's own resolved owner (`providerGhii`), and its author
 *   (`createdBy`) is the calling principal: an agent that declares a split is named as its author,
 *   not the person it acts for. Every refusal is INVALID_INPUT with a sentence that says what to send.
 *
 *   The MCP tool validated with its own copy until 2026-10-16: it stored the owner as the author,
 *   answered EMPTY_SPLIT, EMPTY_CHAIN, ROLES_EXCEED_CUT and INVALID_GHII where REST answers
 *   INVALID_INPUT, and took a missing pool_percent as 0 where REST refuses it.
 * @structure declareSplit · splitView · describeSplit · parseRoles · parseBeneficiaries
 * @usage
 *   const out = await declareSplit(storage, { providerGhii, createdBy: principal }, body);
 *   if (!out.ok) refuse(400, out.code, out.message); else answer(splitView(out.split));
 * @version-history
 *   v1.0.0 — 2026-10-16 — Moved out of routes/commerce-beneficiaries.ts and mcp/commerce.ts; the view names created_by (QA audit D2-08).
 */
import type { Storage } from '../storage/interface.js';
import {
  putSplit, BENEFICIARIES_MAX, type BeneficiarySplit, type BeneficiaryShare, type BeneficiaryRole,
} from './beneficiary-split.js';

/** What a split looks like on the wire. Snake-case, like every other commerce surface. */
export function splitView(s: BeneficiarySplit): Record<string, unknown> {
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
    /** Who declared it first: the principal that called, an agent's GAII when an agent did. */
    created_by: s.createdBy,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

/**
 * The arrangement in one sentence, derived from the record settlement actually reads.
 *
 * Derived rather than authored, so a listing cannot advertise a split the node would not honour. A
 * seller writing their own sentence here would be marketing; this is a description.
 */
export function describeSplit(s: BeneficiarySplit): string {
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
export function parseRoles(raw: unknown): { rows: BeneficiaryRole[] } | { bad: string } {
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
export function parseBeneficiaries(raw: unknown): { rows: BeneficiaryShare[] } | { bad: string } {
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

export type DeclareSplitOutcome =
  | { ok: true; split: BeneficiarySplit }
  | { ok: false; code: 'INVALID_INPUT'; message: string };

/**
 * Validate a declaration and write it for `providerGhii`, authored by `createdBy`. `body` carries
 * the wire fields: ext, action, mode, pool_percent, roles, beneficiaries, dynamic, capability, state.
 */
export async function declareSplit(
  storage: Storage,
  who: { providerGhii: string; createdBy: string },
  body: Record<string, unknown>,
): Promise<DeclareSplitOutcome> {
  const refuse = (message: string): DeclareSplitOutcome => ({ ok: false, code: 'INVALID_INPUT', message });
  const ext = typeof body.ext === 'string' ? body.ext.trim() : '';
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!ext || !action) return refuse('Name the metered coordinate this split applies to: `ext` and `action`');

  const mode = body.mode === 'roles' ? 'roles' : 'pool';
  const dynamic = body.dynamic === true;
  const roles = parseRoles(body.roles);
  if ('bad' in roles) return refuse(roles.bad);
  const parsed = parseBeneficiaries(body.beneficiaries);
  if ('bad' in parsed) return refuse(parsed.bad);

  let pool = 0;
  if (mode === 'roles') {
    if (!roles.rows.length) {
      return refuse('A role chain needs at least one role. Each role takes its own percent of your cut and they '
        + 'total at most 100; an unfilled role simply pays nobody.');
    }
  } else {
    pool = Number(body.pool_percent);
    if (!Number.isFinite(pool) || pool < 0 || pool > 100) {
      return refuse('`pool_percent` is the share of YOUR cut that goes to beneficiaries, 0-100');
    }
    if (!parsed.rows.length && !dynamic) {
      return refuse('A split with no beneficiaries and no `dynamic: true` would divide nothing. Either list who '
        + 'shares it, or set `dynamic: true` so the capability may name them per call.');
    }
  }

  const split = await putSplit(storage, {
    providerGhii: who.providerGhii, ext, action,
    capabilityLabel: typeof body.capability === 'string' ? body.capability : undefined,
    mode, poolPercent: pool, beneficiaries: parsed.rows, roles: roles.rows, dynamic,
    state: body.state === 'paused' ? 'paused' : 'active',
    createdBy: who.createdBy,
  });
  return { ok: true, split };
}
