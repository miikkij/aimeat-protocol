/**
 * @file src/services/kyc/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three views that are not one organism's cards: the person's own (their
 *   verification history and the organisms they gave it to), the organisms where the person does
 *   customer due diligence, and the operator's counts.
 *
 *   THE OPERATOR COUNTS AND NEVER NAMES. The operator is not the firm: it sees whether the lists are
 *   fresh, how many cards each obliged organism keeps, by status and risk, how many are due and how
 *   many carry an open hit, and nothing that names a customer. Suspicions are not counted at all, not
 *   even as a number (AMLR art. 73: their existence is not disclosed outside the firm).
 * @structure kycMine · kycOrganismsOf · kycOperatorView · kycRefreshLists
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { CallerContext } from '../caller-context.js';
import { amlMode, readAmlDeclarations } from '../aml/gate.js';
import { eidasLevelOf, readDisclosures, readVerificationHistory } from '../account/verification-history.js';
import { KycError, type KycDeps } from './access.js';
import { listMetas, sanctionsSources } from './screening/store.js';
import { runKycLists } from './jobs.js';
import { listHeads, organismsWithKyc, readSettings } from './store.js';

export async function kycMine(deps: KycDeps, caller: CallerContext) {
  if (caller.visitor) throw new KycError(403, 'KYC_VISITOR', 'A session from another node has no verification history here.');
  const history = await readVerificationHistory(deps.storage, caller.ownerGhii);
  return {
    verifications: history.map(v => ({ ...v, eidasLevel: eidasLevelOf(v.method) })),
    disclosures: await readDisclosures(deps.storage, caller.ownerGhii),
    note: 'A disclosure cannot be taken back from the firm: the anti-money-laundering law keeps its copy for five years after the relationship ends (AMLR art. 77).',
  };
}

/** The obliged organisms the caller belongs to, with the caller's KYC role in each. */
export async function kycOrganismsOf(deps: KycDeps, caller: CallerContext) {
  if (caller.visitor) return { mode: amlMode(deps.config), organisms: [] };
  const declared = new Set((await readAmlDeclarations(deps.storage, deps.config.nodeId))
    .filter(d => d.scope.kind === 'organism').map(d => (d.scope as { organismId: string }).organismId));
  const out: Array<{ id: string; name: string; role: string; declared: boolean }> = [];
  for (const m of await deps.storage.listMembershipsByGhii(caller.owner)) {
    if (m.status !== 'active') continue;
    const org = await deps.storage.getOrganism(m.organismId);
    if (!org) continue;
    const settings = await readSettings(deps.storage, deps.config.nodeId, org.id);
    const role = settings.officers.includes(caller.ownerGhii) ? 'officer' : settings.staff.includes(caller.ownerGhii) ? 'staff'
      : (m.role === 'creator' || m.role === 'admin') ? 'manager' : 'none';
    if (role === 'none' && !declared.has(org.id)) continue;
    out.push({ id: org.id, name: org.name, role, declared: declared.has(org.id) });
  }
  return { mode: amlMode(deps.config), organisms: out };
}

export async function kycOperatorView(deps: KycDeps, caller: CallerContext) {
  if (!await caller.operator()) throw new KycError(403, 'OPERATOR_ONLY', 'The operator\'s view of customer due diligence.');
  const today = new Date().toISOString().slice(0, 10);
  const organisms: Array<{ id: string; name: string; cards: number; byStatus: Record<string, number>; byRisk: Record<string, number>; due: number; openHits: number; notScreened: number; officers: number }> = [];
  for (const orgId of await organismsWithKyc(deps.storage, deps.config.nodeId)) {
    const org = await deps.storage.getOrganism(orgId);
    const heads = await listHeads(deps.storage, deps.config.nodeId, orgId);
    const settings = await readSettings(deps.storage, deps.config.nodeId, orgId);
    const count = (k: (h: typeof heads[number]) => string | null) => heads.reduce<Record<string, number>>((a, h) => { const v = k(h) ?? 'none'; a[v] = (a[v] ?? 0) + 1; return a; }, {});
    organisms.push({
      id: orgId, name: org?.name ?? orgId, cards: heads.length, byStatus: count(h => h.status), byRisk: count(h => h.risk),
      due: heads.filter(h => h.status !== 'ended' && h.nextReviewAt && h.nextReviewAt <= today).length,
      openHits: heads.filter(h => h.sanctions === 'possible').length,
      notScreened: heads.filter(h => h.status !== 'ended' && h.sanctions === 'not-screened').length,
      officers: settings.officers.length,
    });
  }
  const { urls } = sanctionsSources(deps.config);
  return {
    mode: amlMode(deps.config),
    ai: deps.config.kycAi,
    sources: Object.keys(urls),
    lists: await listMetas(deps.storage, deps.config.nodeId),
    organisms,
  };
}

/** The operator fetches the sanctions lists now (the first time, or after changing the sources), and every open card is screened again when one changed. */
export async function kycRefreshLists(deps: KycDeps, caller: CallerContext) {
  if (!await caller.operator()) throw new KycError(403, 'OPERATOR_ONLY', 'Only the operator fetches the sanctions lists.');
  return runKycLists(deps.storage, deps.config, { force: true });
}
