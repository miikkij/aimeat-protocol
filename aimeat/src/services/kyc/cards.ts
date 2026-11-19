/**
 * @file src/services/kyc/cards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Customer cards: the one write path REST (routes/kyc/routes.ts) and MCP (mcp/kyc.ts) share.
 *
 *   EVERY CHANGE IS RE-ASSESSED. A change to what the card says (a name, an owner, the purpose, the
 *   identity) screens the card again when lists are present and rates the risk again, in the same
 *   version, so a card never shows a rating that its own facts no longer support. The status follows:
 *   `blocked` while something stops onboarding (a possible or confirmed sanctions hit, no identity, an
 *   entity without known beneficial owners) or while a high-risk or PEP customer waits for senior
 *   approval; `active` otherwise; `ended` after the relationship ends, when the five-year retention runs
 *   (AMLR art. 77).
 *
 *   HUMAN DECISIONS stay human: approving a high-risk customer, deciding a screening hit and extending
 *   a hold are made in person (access.ts); an agent prepares them.
 * @structure openCustomer · updateCustomer · recordIdentity · screenCustomer · decideHit · approveCustomer ·
 *   reviewCustomer · endCustomer · extendHold · readCustomer · customerAsOf · listCustomers · rescreenAll
 * @version-history
 *   v1.0.1 — 2026-11-19 — An update keeps the fields it does not send: zod 4 fills a field's default
 *     inside .partial(), so a PATCH without pep set it to 'unknown' and one without owners to [].
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { randomUUID } from 'node:crypto';
import type { CallerContext } from '../caller-context.js';
import { KycError, kycContext, requireCards, requireInPerson, requireOfficer, requireSettings, type KycContext, type KycDeps } from './access.js';
import {
  CustomerInputSchema, IdentitySchema, KycSettingsSchema,
  type CustomerHead, type CustomerInput, type CustomerVersion, type Identity, type Screening, type ScreeningHit,
} from './contract.js';
import { rateRisk, retentionUntil, type RiskFacts } from './risk.js';
import { screen, type SanctionsList, type Subject } from './screening/index.js';
import { loadLists } from './screening/store.js';
import { appendVersion, listHeads, readHead, readSettings, readVersions, versionAsOf, writeSettings } from './store.js';
import type { KycSettings } from './contract.js';

const MAX_HOLD_YEARS = 10;

function newId(): string { return `c-${randomUUID().slice(0, 13)}`; }

function now(): string { return new Date().toISOString(); }

/** The subjects a card screens: the customer and each beneficial owner. */
function subjectsOf(v: Pick<CustomerVersion, 'kind' | 'name' | 'aliases' | 'birthDate' | 'country' | 'beneficialOwners'>): Array<{ key: ScreeningHit['subject']; subject: Subject }> {
  const out: Array<{ key: ScreeningHit['subject']; subject: Subject }> = [
    { key: 'customer', subject: { kind: v.kind, name: v.name, aliases: v.aliases, birthDate: v.birthDate, country: v.country } },
  ];
  v.beneficialOwners.forEach((o, i) => out.push({ key: `owner:${i}`, subject: { kind: 'person', name: o.name, birthDate: o.birthDate, country: o.country } }));
  return out;
}

/** Screen a card's subjects; keeps the decision on a hit that is found again (same source, id and subject). */
function screened(v: CustomerVersion, lists: SanctionsList[], at: string): Screening {
  if (lists.length === 0) return { status: 'not-screened', lists: {}, hits: v.screening.hits };
  const hits: ScreeningHit[] = [];
  for (const { key, subject } of subjectsOf(v)) {
    for (const h of screen(subject, lists)) {
      const was = v.screening.hits.find(x => x.source === h.source && x.id === h.id && x.subject === key);
      hits.push({
        source: h.source, id: h.id, kind: h.kind, matchedName: h.matchedName, listedName: h.listedName, score: h.score,
        reasons: h.reasons.slice(0, 12), programme: h.programme.slice(0, 300), subject: key,
        verdict: was?.verdict ?? 'open', decidedBy: was?.decidedBy, decidedAt: was?.decidedAt, note: was?.note,
      });
    }
  }
  return { status: statusOfHits(hits), screenedAt: at, lists: Object.fromEntries(lists.map(l => [l.source, l.version])), hits };
}

function statusOfHits(hits: ScreeningHit[]): Screening['status'] {
  if (hits.some(h => h.verdict === 'confirmed')) return 'confirmed';
  if (hits.some(h => h.verdict === 'open')) return 'possible';
  return 'clear';
}

/** The facts the risk rule reads, from the card. */
function factsOf(v: CustomerVersion): RiskFacts {
  const countries = [v.country, v.nationality, ...v.beneficialOwners.map(o => o.country)].filter((c): c is string => !!c);
  return {
    kind: v.kind, pep: v.pep, sanctions: v.screening.status, countries,
    identityLevel: v.identity?.level ?? 'none', faceToFace: v.identity?.faceToFace ?? false,
    beneficialOwnersKnown: v.kind === 'person' || v.beneficialOwners.length > 0,
    ownershipLayers: v.ownershipLayers, nomineeOrBearerShares: v.nomineeOrBearerShares, cashIntensive: v.cashIntensive,
    purposeKnown: !!v.purpose?.trim(), sourceOfFundsKnown: !!v.sourceOfFunds?.trim(), productRisk: v.productRisk,
  };
}

/** Rate the card again and set its status and next review; keeps an approval only while the level did not rise. */
function rated(v: CustomerVersion, settings: KycSettings, by: string, at: string): CustomerVersion {
  if (v.status === 'ended') return v;
  const r = rateRisk(factsOf(v), { highRiskCountries: settings.highRiskCountries, reviewMonths: settings.reviewMonths }, new Date(at));
  const order = ['low', 'medium', 'high', 'prohibited'];
  const keep = v.risk?.approvedBy && order.indexOf(r.level) <= order.indexOf(v.risk.level);
  const risk = {
    level: r.level, score: r.score, dueDiligence: r.dueDiligence, reasons: r.reasons.slice(0, 40),
    needsSeniorApproval: r.needsSeniorApproval, blocking: r.blocking.slice(0, 20), ratedAt: at, ratedBy: by,
    approvedBy: keep ? v.risk?.approvedBy : undefined, approvedAt: keep ? v.risk?.approvedAt : undefined,
  };
  const waiting = r.needsSeniorApproval && !risk.approvedBy;
  const status = r.blocking.length > 0 || waiting ? 'blocked' : 'active';
  // The next review counts from the last review, or from this rating when there has been none.
  const nextReviewAt = status === 'active' ? addFrom(v.lastReviewedAt ?? at, settings, r.level) : null;
  return { ...v, risk, status, nextReviewAt };
}

function addFrom(base: string, settings: KycSettings, level: string): string | null {
  const months = level === 'high' ? settings.reviewMonths.high : level === 'medium' ? settings.reviewMonths.medium : level === 'low' ? settings.reviewMonths.low : null;
  if (!months) return null;
  const d = new Date(base);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Screen and rate a version that is being built. */
async function assessed(deps: KycDeps, ctx: KycContext, v: CustomerVersion): Promise<CustomerVersion> {
  const lists = await loadLists(deps.storage, deps.config.nodeId);
  const s = screened(v, lists, v.at);
  return rated({ ...v, screening: s }, ctx.settings, ctx.by, v.at);
}

async function cardsContext(deps: KycDeps, caller: CallerContext, org: string): Promise<KycContext> {
  const ctx = await kycContext(deps, caller, org);
  requireCards(ctx);
  return ctx;
}

function parseInput(input: unknown): CustomerInput {
  const parsed = CustomerInputSchema.safeParse(input ?? {});
  if (!parsed.success) throw new KycError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  // A field's .default() still fires inside .partial() (zod 4): an update that leaves out pep or
  // beneficialOwners would reset them to 'unknown' and []. Only the fields the caller sent count.
  const sent = new Set(Object.keys((input ?? {}) as Record<string, unknown>));
  return Object.fromEntries(Object.entries(parsed.data).filter(([k]) => sent.has(k))) as CustomerInput;
}

async function current(deps: KycDeps, org: string, id: string): Promise<CustomerVersion> {
  const versions = await readVersions(deps.storage, deps.config.nodeId, org, id);
  const v = versions.at(-1);
  if (!v) throw new KycError(404, 'CUSTOMER_NOT_FOUND', 'No such customer card in this organism.');
  return v;
}

/** Add a version built from the newest one; refuses on an ended card unless `allowEnded`. */
async function change(deps: KycDeps, ctx: KycContext, id: string, kind: CustomerVersion['change'], note: string | undefined,
  edit: (prev: CustomerVersion, at: string) => CustomerVersion | Promise<CustomerVersion>, opts: { allowEnded?: boolean; assess?: boolean } = {}): Promise<CustomerVersion> {
  const prevNow = await current(deps, ctx.org, id);
  if (prevNow.status === 'ended' && !opts.allowEnded) throw new KycError(409, 'CUSTOMER_ENDED', 'The relationship has ended; the card is kept for its retention and does not change.');
  const at = now();
  const built = await edit(prevNow, at);
  const draft: CustomerVersion = { ...built, n: prevNow.n + 1, at, by: ctx.by, change: kind, note: note?.slice(0, 2000) };
  const next = opts.assess === false ? draft : await assessed(deps, ctx, draft);
  return appendVersion(deps.storage, deps.config.nodeId, ctx.org, id, (prev, n) => {
    if (!prev || prev.n !== prevNow.n) throw new KycError(409, 'CUSTOMER_CHANGED', 'The card changed meanwhile; read it again and repeat.');
    return { ...next, n };
  });
}

export async function openCustomer(deps: KycDeps, caller: CallerContext, org: string, input: unknown): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  const data = parseInput(input);
  if (!data.kind || !data.name) throw new KycError(400, 'INVALID_INPUT', 'kind (person or entity) and name are needed to open a card.');
  const id = newId();
  const at = now();
  const base: CustomerVersion = {
    id, organism: org, n: 1, at, by: ctx.by, change: 'opened', kind: data.kind, name: data.name,
    aliases: data.aliases ?? [], birthDate: data.birthDate, nationality: data.nationality, country: data.country,
    businessId: data.businessId, contact: data.contact, identity: null, beneficialOwners: data.beneficialOwners ?? [],
    ownershipLayers: data.ownershipLayers, nomineeOrBearerShares: data.nomineeOrBearerShares, cashIntensive: data.cashIntensive,
    productRisk: data.productRisk, purpose: data.purpose, sourceOfFunds: data.sourceOfFunds, pep: data.pep ?? 'unknown',
    pepDetail: data.pepDetail, screening: { status: 'not-screened', lists: {}, hits: [] }, risk: null, status: 'open',
  };
  const v = await assessed(deps, ctx, base);
  return appendVersion(deps.storage, deps.config.nodeId, org, id, (_prev, n) => ({ ...v, n }));
}

export async function updateCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string, input: unknown, note?: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  const data = parseInput(input);
  return change(deps, ctx, id, 'updated', note, (prev) => ({ ...prev, ...stripUndefined(data) }));
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Record how the customer's identity was verified (a document seen, a register extract, or a shared bank ID). */
export async function recordIdentity(deps: KycDeps, caller: CallerContext, org: string, id: string, identity: unknown, note?: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  const parsed = IdentitySchema.safeParse(identity);
  if (!parsed.success) throw new KycError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return writeIdentity(deps, ctx, id, parsed.data, note);
}

/** The identity write itself, for recordIdentity and for the customer's own identify link (identify.ts). */
export async function writeIdentity(deps: KycDeps, ctx: KycContext, id: string, identity: Identity, note?: string): Promise<CustomerVersion> {
  return change(deps, ctx, id, 'identified', note, (prev) => ({ ...prev, identity }));
}

export async function screenCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  return change(deps, ctx, id, 'screened', undefined, (prev) => prev);
}

export async function decideHit(deps: KycDeps, caller: CallerContext, org: string, id: string,
  hit: { source: string; id: string; subject: string }, verdict: 'false-positive' | 'confirmed', note: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  requireInPerson(ctx, 'Deciding a sanctions hit');
  if (!note?.trim()) throw new KycError(400, 'INVALID_INPUT', 'Say why: the decision on a hit is kept with its ground.');
  const at = now();
  return change(deps, ctx, id, 'hit-decided', note, (prev) => {
    const hits = prev.screening.hits.map(h => (h.source === hit.source && h.id === hit.id && h.subject === hit.subject
      ? { ...h, verdict, decidedBy: ctx.by, decidedAt: at, note: note.slice(0, 1000) } : h));
    if (!hits.some(h => h.decidedAt === at)) throw new KycError(404, 'HIT_NOT_FOUND', 'No such hit on this card.');
    return { ...prev, screening: { ...prev.screening, hits, status: statusOfHits(hits) } };
  });
}

/** Senior approval of a high-risk or PEP customer (AMLR art. 34, 43): the officer or an admin, in person. */
export async function approveCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string, note: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  requireInPerson(ctx, 'Approving a customer');
  if (ctx.role !== 'officer' && ctx.role !== 'manager') throw new KycError(403, 'KYC_NOT_MANAGER', 'Senior approval is given by the compliance officer or an admin of the organism.');
  const prev = await current(deps, org, id);
  if (!prev.risk?.needsSeniorApproval) throw new KycError(409, 'NO_APPROVAL_NEEDED', 'This customer does not need senior approval.');
  if ((prev.risk.blocking ?? []).length) throw new KycError(409, 'CUSTOMER_BLOCKED', `Resolve first: ${prev.risk.blocking.join(', ')}.`);
  const at = now();
  return change(deps, ctx, id, 'approved', note, (p) => ({ ...p, risk: p.risk ? { ...p.risk, approvedBy: ctx.by, approvedAt: at } : p.risk }));
}

/** A periodic or event-driven review (AMLR art. 26): screened and rated again, the next review set from today. */
export async function reviewCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string, note: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  return change(deps, ctx, id, 'reviewed', note, (prev, at) => ({ ...prev, lastReviewedAt: at }));
}

/** The relationship ends: the card stops changing and is kept five years (AMLR art. 77), then purged. */
export async function endCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string, note?: string, endedAt?: string): Promise<CustomerVersion> {
  const ctx = await cardsContext(deps, caller, org);
  const end = endedAt && Number.isFinite(Date.parse(endedAt)) ? new Date(endedAt).toISOString() : now();
  return change(deps, ctx, id, 'ended', note, (prev) => ({
    ...prev, status: 'ended', endedAt: end, nextReviewAt: null, retainUntil: retentionUntil(end), holdBasis: 'AMLR art. 77',
  }), { assess: false });
}

/** Keep an ended card longer: an authority's request, a proceeding (at most 10 years from the end). */
export async function extendHold(deps: KycDeps, caller: CallerContext, org: string, id: string, until: string, basis: string): Promise<CustomerVersion> {
  const ctx = await kycContext(deps, caller, org);
  requireOfficer(ctx);
  if (!basis?.trim()) throw new KycError(400, 'INVALID_INPUT', 'Name the ground of the longer hold (an authority\'s request, a proceeding).');
  const prev = await current(deps, org, id);
  if (prev.status !== 'ended' || !prev.endedAt) throw new KycError(409, 'CUSTOMER_NOT_ENDED', 'Only an ended relationship has a hold to extend.');
  const max = retentionUntil(prev.endedAt, MAX_HOLD_YEARS);
  if (!Number.isFinite(Date.parse(until)) || until > max || until <= (prev.retainUntil ?? '')) {
    throw new KycError(400, 'INVALID_HOLD', `The new date must be after ${prev.retainUntil} and at most ${max} (10 years from the end).`);
  }
  return change(deps, ctx, id, 'hold-extended', basis, (p) => ({ ...p, retainUntil: until.slice(0, 10), holdBasis: basis.slice(0, 500) }), { allowEnded: true, assess: false });
}

export interface CustomerRead { card: CustomerVersion; versions: Array<Pick<CustomerVersion, 'n' | 'at' | 'by' | 'change' | 'note'>> }

export async function readCustomer(deps: KycDeps, caller: CallerContext, org: string, id: string): Promise<CustomerRead> {
  await cardsContext(deps, caller, org);
  const versions = await readVersions(deps.storage, deps.config.nodeId, org, id);
  const card = versions.at(-1);
  if (!card) throw new KycError(404, 'CUSTOMER_NOT_FOUND', 'No such customer card in this organism.');
  return { card, versions: versions.map(v => ({ n: v.n, at: v.at, by: v.by, change: v.change, note: v.note })) };
}

/** The card as it stood at `at`: what the firm knew that day, who wrote it and why. */
export async function customerAsOf(deps: KycDeps, caller: CallerContext, org: string, id: string, at: string): Promise<{ asOf: string; card: CustomerVersion | null; newer: number }> {
  await cardsContext(deps, caller, org);
  if (!Number.isFinite(Date.parse(at))) throw new KycError(400, 'INVALID_INPUT', 'as_of must be a date or a time (ISO 8601).');
  // A bare date means the end of that day: what was known on it.
  const when = /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T23:59:59.999Z` : new Date(at).toISOString();
  const versions = await readVersions(deps.storage, deps.config.nodeId, org, id);
  if (versions.length === 0) throw new KycError(404, 'CUSTOMER_NOT_FOUND', 'No such customer card in this organism.');
  const card = versionAsOf(versions, when);
  return { asOf: when, card, newer: versions.filter(v => v.n > (card?.n ?? 0)).length };
}

export async function listCustomers(deps: KycDeps, caller: CallerContext, org: string, opts: { due?: boolean; status?: string } = {}): Promise<CustomerHead[]> {
  await cardsContext(deps, caller, org);
  let heads = await listHeads(deps.storage, deps.config.nodeId, org);
  if (opts.status) heads = heads.filter(h => h.status === opts.status);
  if (opts.due) {
    const today = now().slice(0, 10);
    heads = heads.filter(h => h.status !== 'ended' && (!h.nextReviewAt || h.nextReviewAt <= today || h.sanctions === 'possible'));
  }
  return heads;
}

/** Settings: who does the work, who the officers are, and the firm's risk rules. */
export async function updateSettings(deps: KycDeps, caller: CallerContext, org: string, patch: Partial<KycSettings>): Promise<KycSettings> {
  const ctx = await kycContext(deps, caller, org);
  requireSettings(ctx);
  // Validated before the write, so a wrong value answers 400 with the field, not a failure inside the write.
  const parsed = KycSettingsSchema.partial().safeParse(stripUndefined((patch ?? {}) as Record<string, unknown>));
  if (!parsed.success) throw new KycError(400, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return writeSettings(deps.storage, deps.config.nodeId, org, (cur) => ({
    ...cur, ...stripUndefined(parsed.data as Record<string, unknown>), updatedAt: now(), updatedBy: ctx.by,
  }) as KycSettings);
}

export async function readSettingsFor(deps: KycDeps, caller: CallerContext, org: string): Promise<{ settings: KycSettings; role: string }> {
  const ctx = await kycContext(deps, caller, org);
  if (ctx.role === 'none') throw new KycError(403, 'KYC_NOT_STAFF', 'Only the organism\'s officers, staff and admins read its KYC settings.');
  return { settings: ctx.settings, role: ctx.role };
}

/**
 * Screen every open card of every organism again (a list changed). Writes a version only where the
 * hits changed; answers the cards with a new open hit, for the officers' notice. Run by the list
 * refresh job as the node, with no caller.
 */
export async function rescreenAll(deps: KycDeps, orgs: string[]): Promise<Array<{ org: string; id: string; name: string }>> {
  const lists = await loadLists(deps.storage, deps.config.nodeId);
  if (lists.length === 0) return [];
  const flagged: Array<{ org: string; id: string; name: string }> = [];
  for (const org of orgs) {
    const settings = await readSettings(deps.storage, deps.config.nodeId, org);
    for (const head of await listHeads(deps.storage, deps.config.nodeId, org)) {
      if (head.status === 'ended') continue;
      const versions = await readVersions(deps.storage, deps.config.nodeId, org, head.id);
      const prev = versions.at(-1);
      if (!prev) continue;
      const at = now();
      const s = screened(prev, lists, at);
      const before = new Set(prev.screening.hits.map(h => `${h.source}|${h.id}|${h.subject}`));
      const fresh = s.hits.filter(h => !before.has(`${h.source}|${h.id}|${h.subject}`));
      const sameLists = JSON.stringify(s.lists) === JSON.stringify(prev.screening.lists);
      if (fresh.length === 0 && sameLists) continue;
      const next = rated({ ...prev, screening: s, n: prev.n + 1, at, by: `system@${deps.config.nodeId}`, change: 'screened', note: 'A sanctions list changed; screened again.' },
        settings, `system@${deps.config.nodeId}`, at);
      await appendVersion(deps.storage, deps.config.nodeId, org, head.id, (_p, n) => ({ ...next, n }));
      if (fresh.length) flagged.push({ org, id: head.id, name: head.name });
    }
  }
  return flagged;
}

export { readHead };
