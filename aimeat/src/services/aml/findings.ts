/**
 * @file src/services/aml/findings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What in this node may be work the EU anti-money-laundering regulation (2024/1624) gives
 *   an obliged entity, and what a declared obliged entity here still leaves open, read from the records
 *   that already exist and from nothing new:
 *     org_declares_obliged    organisms that declared themselves obliged entities (compliance document `aml`);
 *     declaration_missing     mode owners or node with no declaration to show for it;
 *     roles_incomplete        a declaration that names no compliance manager or no deputy (art. 11);
 *     registration_missing    a declaration with no supervisor registration or no FIU registration;
 *     risk_assessment_stale   a declaration whose business-wide risk assessment is missing or over a year old (art. 10);
 *     payouts_for_others      revenue splits that pay a share to someone other than the provider;
 *     crypto_for_others       stablecoin payouts to beneficiaries this node orchestrated (MiCA);
 *     agent_spends_money      agents whose owner let them spend money (commerce.agent-limits);
 *     payers_not_screened     sellers with a money rail, which pay the platform fee: sanctions apply to everyone;
 *     personal_services_sold  agent work listed for money (a DAC7 question);
 *     marketplace_traders     accounts that list offerings for money to everyone (DSA art. 30).
 *   Every kind is present, with count 0 when nothing matches, so a reader sees what was looked at;
 *   the per-declaration kinds name the organism after a colon. Every finding is a proposal (source
 *   `proposed`) until a person reviews it in the compliance document `aml`.
 *
 *   THE OWNER'S SLICE holds only the owner's own: the organisms they manage, their splits, payouts,
 *   agents, rails and offerings. Nothing about another account.
 * @structure ITEM_CAP · AmlFacts · gatherAmlFacts · buildAmlFindings
 * @usage const facts = await gatherAmlFacts(deps, { owner }); const findings = buildAmlFindings(facts);
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design, stage A).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { listAllMemoryPages } from '../../storage/memory-pages.js';
import { listDocs } from '../compliance/docs.js';
import type { IntermediationReview } from '../compliance/docs-schemas.js';
import { isOrgManager } from '../workspace/access.js';
import { listOfferings } from '../exchange/market.js';
import { NS_BENEFICIARY_SPLIT, type BeneficiarySplit } from '../../commerce/beneficiary-split.js';
import { LIMITS_KEY, type PurchaseLimits } from '../../commerce/agent-purchase-limit.js';
import { isMoneyCurrency } from '../../commerce/money.js';
import { AMLR_REFS, type AmlFinding } from './contract.js';
import { readAmlDeclarations, type AmlDeclarationAt } from './gate.js';

/** Items a finding lists; the count is the whole. */
export const ITEM_CAP = 50;
/** A risk assessment older than this is reported. Art. 10 asks for one kept up to date; the year is this node's reading. */
const RISK_ASSESSMENT_MAX_DAYS = 365;

/** What the findings and the obligation rows are computed from. */
export interface AmlFacts {
  mode: AimeatConfig['amlMode'];
  owner: string | null;
  now: string;
  declarations: Array<AmlDeclarationAt & { organismName?: string }>;
  reviews: Map<string, IntermediationReview>;
  splitsForOthers: Array<{ provider: string; capability: string; beneficiaries: number }>;
  cryptoPayouts: Array<{ from: string; beneficiary: string; count: number }>;
  agentLimits: Array<{ owner: string; agents: number }>;
  sellers: Array<{ owner: string; rails: string[] }>;
  personalServices: Array<{ offeringId: string; title: string; provider: string }>;
  traders: Array<{ provider: string; offerings: number }>;
}

const isLocalAccount = (ghii: string, nodeId: string): boolean => ghii.endsWith(`@${nodeId}`) && !ghii.includes('#');

/** Read everything the section needs once. `owner` narrows every list to that account. */
export async function gatherAmlFacts(deps: { storage: Storage; config: AimeatConfig }, opts: { owner?: string | null; now?: string } = {}): Promise<AmlFacts> {
  const { storage, config } = deps;
  const owner = opts.owner ?? null;
  const mine = (account: string) => !owner || account === owner;

  const reviews = new Map<string, IntermediationReview>();
  // The node's reviews win over an organism's for the same finding.
  const docs = (await listDocs(storage, config.nodeId, 'aml')).sort((a, b) => (a.scope.kind === 'node' ? 1 : 0) - (b.scope.kind === 'node' ? 1 : 0));
  for (const d of docs) for (const i of d.doc.items) if (i.type === 'review') reviews.set(i.id, i);

  const declarations: AmlFacts['declarations'] = [];
  for (const d of await readAmlDeclarations(storage, config.nodeId)) {
    if (d.scope.kind === 'organism') {
      if (owner && !(await isOrgManager(storage, d.scope.organismId, owner))) continue;
      const org = await storage.getOrganism(d.scope.organismId);
      declarations.push({ ...d, ...(org ? { organismName: org.name } : {}) });
    } else if (!owner) declarations.push(d);
  }

  // Revenue splits that pay someone other than the provider (commerce/beneficiary-split.ts).
  const splitsForOthers: AmlFacts['splitsForOthers'] = [];
  const splits = await listAllMemoryPages(storage, { prefix: 'bensplit.', ownerPrefix: NS_BENEFICIARY_SPLIT, excludeVersionRows: true });
  for (const r of splits.items) {
    if (r.ownerGaii !== NS_BENEFICIARY_SPLIT) continue;
    const s = r.value as BeneficiarySplit | null;
    if (!s?.providerGhii || s.state === 'paused') continue;
    const provider = localAccountName(s.providerGhii);
    if (!mine(provider)) continue;
    const others = new Set([...(s.beneficiaries ?? []).map(b => b.ghii), ...(s.roles ?? []).map(x => x.ghii)]
      .filter((g): g is string => !!g && g !== s.providerGhii));
    if (others.size || s.dynamic) splitsForOthers.push({ provider, capability: s.capabilityLabel || `${s.ext}/${s.action}`, beneficiaries: others.size });
  }

  // Stablecoin payouts the node orchestrated from a provider to a beneficiary (commerce/beneficiary-payout.ts).
  const payoutCounts = new Map<string, { from: string; beneficiary: string; count: number }>();
  const benefits = await listAllMemoryPages(storage, { prefix: 'commerce.benefit.', excludeVersionRows: true });
  for (const r of benefits.items) {
    if (!isLocalAccount(r.ownerGaii, config.nodeId)) continue;
    const beneficiary = localAccountName(r.ownerGaii);
    // The book's shape: { items: BeneficiaryEntry[] } (commerce/beneficiary-book.ts entriesOf).
    const entries = (r.value as { items?: Array<{ status?: string; payoutRail?: string; fromGhii?: string }> } | null)?.items ?? [];
    for (const e of entries) {
      if (e.status !== 'paid' || !e.payoutRail?.startsWith('x402') || !e.fromGhii) continue;
      const from = localAccountName(e.fromGhii);
      if (!mine(from) && !mine(beneficiary)) continue;
      const k = `${from}>${beneficiary}`;
      const cur = payoutCounts.get(k) ?? { from, beneficiary, count: 0 };
      cur.count += 1;
      payoutCounts.set(k, cur);
    }
  }

  // Agents an owner let spend money (commerce/agent-purchase-limit.ts).
  const agentLimits: AmlFacts['agentLimits'] = [];
  for (const r of (await listAllMemoryPages(storage, { prefix: LIMITS_KEY, excludeVersionRows: true })).items) {
    if (r.key !== LIMITS_KEY || !isLocalAccount(r.ownerGaii, config.nodeId)) continue;
    const account = localAccountName(r.ownerGaii);
    if (!mine(account)) continue;
    const limits = (r.value ?? {}) as PurchaseLimits;
    const agents = Object.values(limits).filter(per => Object.entries(per ?? {}).some(([cur, n]) => isMoneyCurrency(cur) && Number(n) > 0)).length;
    if (agents) agentLimits.push({ owner: account, agents });
  }

  // Sellers with a money rail of their own (commerce/psp-record.ts).
  const sellers: AmlFacts['sellers'] = [];
  for (const r of (await listAllMemoryPages(storage, { prefix: 'commerce.psp', excludeVersionRows: true })).items) {
    if (r.key !== 'commerce.psp' || !isLocalAccount(r.ownerGaii, config.nodeId)) continue;
    const account = localAccountName(r.ownerGaii);
    if (!mine(account)) continue;
    const v = (r.value ?? {}) as { secretKey?: unknown; address?: string; payTo?: string; x402?: { address?: string; payTo?: string } };
    const rails = [
      ...(v.secretKey ? ['card'] : []),
      ...(v.address || v.payTo || v.x402?.address || v.x402?.payTo ? ['stablecoin'] : []),
    ];
    if (rails.length) sellers.push({ owner: account, rails });
  }

  // Offerings listed to everyone for money.
  const personalServices: AmlFacts['personalServices'] = [];
  const byProvider = new Map<string, number>();
  for (const o of await listOfferings(storage)) {
    if (!o.currency || !isMoneyCurrency(o.currency) || !(o.basePrice > 0) || !mine(o.providerOwner)) continue;
    byProvider.set(o.providerOwner, (byProvider.get(o.providerOwner) ?? 0) + 1);
    if (o.kind === 'agent-work') personalServices.push({ offeringId: o.offeringId, title: o.title, provider: o.providerOwner });
  }

  return {
    mode: config.amlMode, owner, now: opts.now ?? new Date().toISOString(), declarations, reviews,
    splitsForOthers, cryptoPayouts: [...payoutCounts.values()], agentLimits, sellers, personalServices,
    traders: [...byProvider.entries()].map(([provider, offerings]) => ({ provider, offerings })),
  };
}

const cap = <T>(xs: T[]): T[] => xs.slice(0, ITEM_CAP);
const whereOf = (d: AmlFacts['declarations'][number]): string => (d.scope.kind === 'organism' ? d.scope.organismId : 'node');
const nameOf = (d: AmlFacts['declarations'][number]): string => (d.scope.kind === 'organism' ? (d.organismName ?? d.scope.organismId) : 'this server');
const docUrl = (d: AmlFacts['declarations'][number]): string => (d.scope.kind === 'organism'
  ? `/v1/compliance/docs/aml?scope=organism&organism_id=${encodeURIComponent(d.scope.organismId)}` : '/v1/compliance/docs/aml');

/** The findings, from the facts. Pure. */
export function buildAmlFindings(f: AmlFacts): AmlFinding[] {
  const out: AmlFinding[] = [];
  const add = (x: Omit<AmlFinding, 'source' | 'review'>) => {
    const r = f.reviews.get(x.id);
    out.push({ ...x, source: r ? 'human' : 'proposed', ...(r ? { review: { decision: r.decision, ...(r.note ? { note: r.note } : {}), ...(r.reviewedAt ?? r.updatedAt ? { at: r.reviewedAt ?? r.updatedAt } : {}), ...(r.updatedBy ? { by: r.updatedBy } : {}) } } : {}) });
  };
  const orgDecls = f.declarations.filter(d => d.scope.kind === 'organism');
  const nodeDecl = f.declarations.find(d => d.scope.kind === 'node');
  const modeAllowsOwners = f.mode === 'owners' || f.mode === 'node';

  add({
    id: 'org_declares_obliged', kind: 'org_declares_obliged', code: 'aml-org-declares-obliged',
    count: orgDecls.length, items: cap(orgDecls.map(d => ({ organism_id: whereOf(d), organism: nameOf(d), legal_name: d.declaration.legalName, sector: d.declaration.sector }))),
    reason: !orgDecls.length ? 'No organism has declared itself an obliged entity.'
      : modeAllowsOwners ? `${orgDecls.length} organism(s) declared themselves obliged entities, and this server lets them do that work.`
        : `${orgDecls.length} organism(s) declared themselves obliged entities, and this server is set to ${f.mode}. The operator decides whether they do that work here.`,
    regulation: [AMLR_REFS.obliged],
    ...(orgDecls.length && !modeAllowsOwners ? { proposal: { action: 'set_mode_owners', text: 'The operator sets AIMEAT_AML_MODE to owners (Config, compliance) when these organisms do their obliged work here, or asks them to do it elsewhere.', request: { method: 'PUT', url: '/v1/admin/config', body: { changes: [{ path: 'compliance.aml_mode', value: 'owners' }] } } } } : {}),
  });

  const missing = (f.mode === 'owners' && !orgDecls.length && !nodeDecl) || (f.mode === 'node' && !nodeDecl);
  add({
    id: 'declaration_missing', kind: 'declaration_missing', code: 'aml-declaration-missing', count: missing ? 1 : 0, items: [],
    reason: !missing ? 'Every mode that expects a declaration has one, or the mode expects none.'
      : f.mode === 'node' ? 'This server is set as an obliged entity itself, and the operator has stored no declaration.'
        : 'This server lets organisms be obliged entities, and no organism has declared itself one.',
    regulation: [AMLR_REFS.obliged, AMLR_REFS.compliance],
    ...(missing && f.mode === 'node' ? { proposal: { action: 'record_declaration', text: 'Record the declaration: the legal person, its business id, the sector, the compliance officer and manager.', request: { method: 'PUT', url: '/v1/compliance/docs/aml' } } } : {}),
  });

  const perDeclaration = (kind: 'roles_incomplete' | 'registration_missing' | 'risk_assessment_stale', code: string, hit: (d: AmlFacts['declarations'][number]) => string | null, none: string, regulation: AmlFinding['regulation'], fix: string) => {
    const hits = f.declarations.map(d => ({ d, why: hit(d) })).filter((x): x is { d: AmlFacts['declarations'][number]; why: string } => !!x.why);
    for (const { d, why } of hits) {
      add({
        id: `${kind}:${whereOf(d)}`, kind, code, count: 1,
        items: [{ organism_id: whereOf(d), organism: nameOf(d), legal_name: d.declaration.legalName }],
        reason: `${nameOf(d)}: ${why}`, regulation,
        proposal: { action: kind, text: fix, request: { method: 'PUT', url: docUrl(d) } },
      });
    }
    if (!hits.length) add({ id: kind, kind, code, count: 0, items: [], reason: none, regulation });
  };
  perDeclaration('roles_incomplete', 'aml-roles-incomplete',
    d => (!d.declaration.complianceManager ? 'the declaration names no compliance manager from the management.' : !d.declaration.deputy ? 'the declaration names no deputy for the compliance officer.' : null),
    'Every declaration names its compliance officer, compliance manager and deputy.', [AMLR_REFS.compliance],
    'Add the compliance manager and the deputy to the declaration.');
  perDeclaration('registration_missing', 'aml-registration-missing',
    d => (!d.declaration.supervisorRegisteredAt ? 'no registration with the supervisor is recorded.' : !d.declaration.fiuRegisteredAt ? 'no registration with the FIU\'s reporting service is recorded.' : null),
    'Every declaration records its supervisor and FIU registrations.', [AMLR_REFS.reporting],
    'Record when the entity registered with the supervisor and with the FIU\'s reporting service (goAML in Finland).');
  const ageDays = (iso?: string) => (iso ? (Date.parse(f.now) - Date.parse(iso)) / 86_400_000 : Infinity);
  perDeclaration('risk_assessment_stale', 'aml-risk-assessment-stale',
    d => (!d.declaration.riskAssessmentAt ? 'no business-wide risk assessment is recorded.' : ageDays(d.declaration.riskAssessmentAt) > RISK_ASSESSMENT_MAX_DAYS ? 'the business-wide risk assessment is over a year old.' : null),
    'Every declaration records a business-wide risk assessment from the last year.', [AMLR_REFS.riskAssessment],
    'Update the business-wide risk assessment and record its date and address in the declaration.');

  add({
    id: 'payouts_for_others', kind: 'payouts_for_others', code: 'aml-payouts-for-others',
    count: f.splitsForOthers.length, items: cap(f.splitsForOthers.map(s => ({ provider: s.provider, capability: s.capability, beneficiaries: s.beneficiaries }))),
    reason: f.splitsForOthers.length
      ? `${f.splitsForOthers.length} revenue split(s) pay a share to someone other than the provider. The provider pays from their own rail and this server holds no funds, but a service that moves money for others can become an obliged one.`
      : 'No revenue split pays a share to someone other than the provider.',
    regulation: [AMLR_REFS.obliged],
  });
  add({
    id: 'crypto_for_others', kind: 'crypto_for_others', code: 'aml-crypto-for-others',
    count: f.cryptoPayouts.reduce((n, p) => n + p.count, 0), items: cap(f.cryptoPayouts.map(p => ({ from: p.from, beneficiary: p.beneficiary, payouts: p.count }))),
    reason: f.cryptoPayouts.length
      ? 'This server orchestrated stablecoin payouts from providers to beneficiaries. The provider signs each one and the server holds no key; a server that held the key would be a crypto-asset service.'
      : 'This server has orchestrated no stablecoin payout to a beneficiary.',
    regulation: [AMLR_REFS.mica],
  });
  add({
    id: 'agent_spends_money', kind: 'agent_spends_money', code: 'aml-agent-spends-money',
    count: f.agentLimits.reduce((n, a) => n + a.agents, 0), items: cap(f.agentLimits.map(a => ({ owner: a.owner, agents: a.agents }))),
    reason: f.agentLimits.length
      ? 'Owners have let agents spend money within a daily limit. The agent pays in its owner\'s name, from the owner\'s own rail.'
      : 'No agent may spend money.',
    regulation: [AMLR_REFS.obliged],
  });
  add({
    id: 'payers_not_screened', kind: 'payers_not_screened', code: 'aml-payers-not-screened',
    count: f.sellers.length, items: cap(f.sellers.map(s => ({ owner: s.owner, rails: s.rails }))),
    reason: f.sellers.length
      ? `${f.sellers.length} seller(s) take money here and pay the platform fee. This server screens nobody against the EU sanctions lists yet, and sanctions apply to every business, obliged or not.`
      : 'No account takes money here.',
    regulation: [AMLR_REFS.sanctions],
  });
  add({
    id: 'personal_services_sold', kind: 'personal_services_sold', code: 'aml-personal-services-sold',
    count: f.personalServices.length, items: cap(f.personalServices.map(o => ({ offering_id: o.offeringId, title: o.title, provider: o.provider }))),
    reason: f.personalServices.length
      ? `${f.personalServices.length} agent work offering(s) are listed for money. Work a person does for a fee can be a personal service a platform reports to the tax authority.`
      : 'No agent work is listed for money.',
    regulation: [AMLR_REFS.dac7],
  });
  add({
    id: 'marketplace_traders', kind: 'marketplace_traders', code: 'aml-marketplace-traders',
    count: f.traders.length, items: cap(f.traders.map(t => ({ provider: t.provider, offerings: t.offerings }))),
    reason: f.traders.length
      ? `${f.traders.length} account(s) list offerings for money to everyone. An online marketplace where consumers buy from traders checks the traders' details, unless its operator is a micro or small enterprise.`
      : 'No account lists an offering for money.',
    regulation: [AMLR_REFS.dsaTraders],
  });
  return out;
}
