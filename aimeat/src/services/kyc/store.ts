/**
 * @file src/services/kyc/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where customer due diligence records live and how a version is added and read: records
 *   of `system@<node>` under `kyc.org.<organism>.` (contract.ts says why the node owns them).
 *
 *   KEYS
 *     kyc.org.<org>.settings              the organism's KYC settings
 *     kyc.org.<org>.c.<id>.head           pointer to the newest version, and what a list shows
 *     kyc.org.<org>.c.<id>.v.<000001>     one version of a card, never written again
 *     kyc.org.<org>.r.<id>                a suspicion report (officers only; the service enforces it)
 *     kyc.org.<org>.receipt.<id>          what stays after the purge: no personal data
 *
 *   ADDING A VERSION. The version key is created first, only if absent (createMemoryIfAbsent), with the
 *   number after the head's; two writers at once both read n and one of them loses the create and reads
 *   again. Then the head moves to the new number on its own version (updateRecord), never back. A crash
 *   between the two leaves a version the head does not point to yet; the next write finds that key
 *   taken and builds on it, so nothing is lost and nothing is written twice.
 * @structure keys · readSettings · writeSettings · readHead · listHeads · appendVersion · readVersion ·
 *   readVersions · versionAsOf · readReport · writeReport · listReports · purgeCustomer
 * @version-history
 *   v1.1.0 — 2026-11-19 — announce(): a write tells the organism's KYC people on the `kyc` live domain.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { logger } from '../../utils/logger.js';
import type { MemoryRecord, Storage } from '../../storage/interface.js';
import { systemGhiiFor } from '../compliance/register.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import {
  CustomerHeadSchema, CustomerVersionSchema, KycSettingsSchema, SuspicionReportSchema,
  type CustomerHead, type CustomerVersion, type KycSettings, type PurgeReceipt, type SuspicionReport,
} from './contract.js';

const TAGS = ['kyc'];
const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

/** An id that may go into a key: no dot, slash or space, so it cannot reach another key. */
export function safeKeyPart(s: string): boolean { return SAFE.test(s); }

function must(part: string): string {
  if (!safeKeyPart(part)) throw new Error(`not a key part: ${JSON.stringify(part).slice(0, 60)}`);
  return part;
}

export const keys = {
  org: (org: string) => `kyc.org.${must(org)}.`,
  settings: (org: string) => `kyc.org.${must(org)}.settings`,
  customers: (org: string) => `kyc.org.${must(org)}.c.`,
  head: (org: string, id: string) => `kyc.org.${must(org)}.c.${must(id)}.head`,
  versions: (org: string, id: string) => `kyc.org.${must(org)}.c.${must(id)}.v.`,
  version: (org: string, id: string, n: number) => `kyc.org.${must(org)}.c.${must(id)}.v.${String(n).padStart(6, '0')}`,
  reports: (org: string) => `kyc.org.${must(org)}.r.`,
  report: (org: string, id: string) => `kyc.org.${must(org)}.r.${must(id)}`,
  receipt: (org: string, id: string) => `kyc.org.${must(org)}.receipt.${must(id)}`,
};

/**
 * Tell the people of an organism's customer due diligence that something changed: its officers, its
 * staff and its admins, each on their own stream (the `kyc` live domain). Nobody else hears it.
 */
export async function announce(storage: Storage, nodeId: string, org: string): Promise<void> {
  try {
    const s = await readSettings(storage, nodeId, org);
    const people = new Set<string>([...s.officers, ...s.staff]);
    for (const m of await storage.listMembers(org, { status: 'active' })) {
      if (m.role === 'creator' || m.role === 'admin') people.add(m.ghii.includes('@') ? m.ghii : `${m.ghii}@${nodeId}`);
    }
    for (const ghii of people) emitChange('kyc', ghii);
  } catch (err) {
    // A missed live notice costs a page its refresh, never the write.
    logger.warn('[kyc] the live notice was not sent', { org, error: String(err) });
  }
}

/** True for a key this module writes: the memory delete paths refuse it while it is retained. */
export function isKycKey(key: string): boolean { return key.startsWith('kyc.org.'); }

function record(nodeId: string, key: string, value: unknown, now: string): MemoryRecord {
  return { key, ownerGaii: systemGhiiFor(nodeId), value, visibility: 'private', tags: TAGS, ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

const parseSettings = (v: unknown): KycSettings => KycSettingsSchema.parse(v ?? {});

export async function readSettings(storage: Storage, nodeId: string, org: string): Promise<KycSettings> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), keys.settings(org));
  const parsed = KycSettingsSchema.safeParse(rec?.value ?? {});
  return parsed.success ? parsed.data : KycSettingsSchema.parse({});
}

export async function writeSettings(storage: Storage, nodeId: string, org: string, change: (cur: KycSettings) => KycSettings): Promise<KycSettings> {
  return updateRecord(storage, systemGhiiFor(nodeId), keys.settings(org), parseSettings, (cur) => KycSettingsSchema.parse(change(cur)), { tag: 'kyc', tags: TAGS });
}

export async function readHead(storage: Storage, nodeId: string, org: string, id: string): Promise<CustomerHead | null> {
  if (!safeKeyPart(org) || !safeKeyPart(id)) return null;
  const rec = await storage.getMemory(systemGhiiFor(nodeId), keys.head(org, id));
  const parsed = CustomerHeadSchema.safeParse(rec?.value);
  return parsed.success ? parsed.data : null;
}

/** Every card head of an organism. */
export async function listHeads(storage: Storage, nodeId: string, org: string): Promise<CustomerHead[]> {
  if (!safeKeyPart(org)) return [];
  const rows = await storage.listMemory(systemGhiiFor(nodeId), { prefix: keys.customers(org) });
  const out: CustomerHead[] = [];
  for (const r of rows) {
    if (!r.key.endsWith('.head')) continue;
    const parsed = CustomerHeadSchema.safeParse(r.value);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether an organism still holds customer due diligence records the law keeps: any card that is not
 * purged yet, or any suspicion. Answers the latest day one of them may go, or null when none is held.
 */
export async function retainedUntil(storage: Storage, nodeId: string, org: string): Promise<{ cards: number; reports: number; until: string | null } | null> {
  if (!safeKeyPart(org)) return null;
  const heads = await listHeads(storage, nodeId, org);
  const reports = await listReports(storage, nodeId, org);
  if (heads.length === 0 && reports.length === 0) return null;
  // An open relationship has no end yet, so its records are held with no date.
  const open = heads.some(h => h.status !== 'ended') || reports.some(r => !r.retainUntil);
  const dates = [...heads.map(h => h.retainUntil), ...reports.map(r => r.retainUntil)].filter((d): d is string => !!d).sort();
  return { cards: heads.length, reports: reports.length, until: open ? null : (dates.at(-1) ?? null) };
}

/** The organisms that hold KYC records, from the keys (for the node-wide jobs and the operator's counts). */
export async function organismsWithKyc(storage: Storage, nodeId: string): Promise<string[]> {
  const rows = await storage.listMemory(systemGhiiFor(nodeId), { prefix: 'kyc.org.' });
  const orgs = new Set<string>();
  for (const r of rows) {
    const m = /^kyc\.org\.([^.]+)\./.exec(r.key);
    if (m) orgs.add(m[1]);
  }
  return [...orgs];
}

function headOf(v: CustomerVersion, openedAt: string): CustomerHead {
  return {
    id: v.id, n: v.n, name: v.name, kind: v.kind, status: v.status, risk: v.risk?.level ?? null,
    sanctions: v.screening.status, pep: v.pep, nextReviewAt: v.nextReviewAt ?? null, retainUntil: v.retainUntil ?? null,
    openedAt, updatedAt: v.at,
  };
}

/**
 * Add the next version of a card. `build` gets the newest version (null for a new card) and the
 * number the new one takes, and answers the whole new version. Answers the version as written.
 */
export async function appendVersion(
  storage: Storage, nodeId: string, org: string, id: string,
  build: (prev: CustomerVersion | null, n: number) => CustomerVersion,
): Promise<CustomerVersion> {
  const owner = systemGhiiFor(nodeId);
  for (let attempt = 0; attempt < 10; attempt++) {
    const head = await readHead(storage, nodeId, org, id);
    // A version the head does not point to yet (a crash between the two writes) is the newest one.
    let n = head?.n ?? 0;
    while (await storage.getMemory(owner, keys.version(org, id, n + 1))) n++;
    const prev = n > 0 ? await readVersion(storage, nodeId, org, id, n) : null;
    const next = CustomerVersionSchema.parse(build(prev, n + 1));
    if (next.n !== n + 1 || next.id !== id || next.organism !== org) throw new Error('a version must carry its own id, organism and the next number');
    const now = new Date().toISOString();
    if (!await storage.createMemoryIfAbsent(record(nodeId, keys.version(org, id, next.n), next, now))) continue;
    const openedAt = n === 0 ? next.at : (head?.openedAt ?? next.at);
    await updateRecord(storage, owner, keys.head(org, id), (v) => CustomerHeadSchema.safeParse(v).success ? CustomerHeadSchema.parse(v) : null,
      (cur) => (cur && cur.n >= next.n ? UNCHANGED : headOf(next, cur?.openedAt ?? openedAt)), { tag: 'kyc', tags: TAGS });
    await announce(storage, nodeId, org);
    return next;
  }
  throw new Error(`the card ${id} changed under every one of 10 attempts; try again`);
}

export async function readVersion(storage: Storage, nodeId: string, org: string, id: string, n: number): Promise<CustomerVersion | null> {
  if (!safeKeyPart(org) || !safeKeyPart(id) || !Number.isInteger(n) || n < 1) return null;
  const rec = await storage.getMemory(systemGhiiFor(nodeId), keys.version(org, id, n));
  const parsed = CustomerVersionSchema.safeParse(rec?.value);
  return parsed.success ? parsed.data : null;
}

/** Every version of a card, oldest first. */
export async function readVersions(storage: Storage, nodeId: string, org: string, id: string): Promise<CustomerVersion[]> {
  if (!safeKeyPart(org) || !safeKeyPart(id)) return [];
  const rows = await storage.listMemory(systemGhiiFor(nodeId), { prefix: keys.versions(org, id) });
  const out: CustomerVersion[] = [];
  for (const r of rows) {
    const parsed = CustomerVersionSchema.safeParse(r.value);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.n - b.n);
}

/** The version in force at `at` (the newest written at or before it), or null when the card did not exist yet. */
export function versionAsOf(versions: CustomerVersion[], at: string): CustomerVersion | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  let found: CustomerVersion | null = null;
  for (const v of versions) if (Date.parse(v.at) <= t && (!found || v.n > found.n)) found = v;
  return found;
}

export async function readReport(storage: Storage, nodeId: string, org: string, id: string): Promise<SuspicionReport | null> {
  if (!safeKeyPart(org) || !safeKeyPart(id)) return null;
  const rec = await storage.getMemory(systemGhiiFor(nodeId), keys.report(org, id));
  const parsed = SuspicionReportSchema.safeParse(rec?.value);
  return parsed.success ? parsed.data : null;
}

export async function writeReport(storage: Storage, nodeId: string, org: string, id: string,
  change: (cur: SuspicionReport | null) => SuspicionReport | typeof UNCHANGED): Promise<SuspicionReport | null> {
  const out = await updateRecord(storage, systemGhiiFor(nodeId), keys.report(org, id),
    (v) => { const p = SuspicionReportSchema.safeParse(v); return p.success ? p.data : null; },
    (cur) => { const next = change(cur); return next === UNCHANGED ? UNCHANGED : SuspicionReportSchema.parse(next); },
    { tag: 'kyc', tags: TAGS });
  await announce(storage, nodeId, org);
  return out;
}

export async function listReports(storage: Storage, nodeId: string, org: string): Promise<SuspicionReport[]> {
  if (!safeKeyPart(org)) return [];
  const rows = await storage.listMemory(systemGhiiFor(nodeId), { prefix: keys.reports(org) });
  const out: SuspicionReport[] = [];
  for (const r of rows) {
    const parsed = SuspicionReportSchema.safeParse(r.value);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => b.markedAt.localeCompare(a.markedAt));
}

/**
 * Delete a card whole (every version and the head) and leave a receipt with no personal data. Only
 * the retention purge calls this, and only after the card's retainUntil.
 */
export async function purgeCustomer(storage: Storage, nodeId: string, org: string, id: string, basis: string): Promise<PurgeReceipt | null> {
  const owner = systemGhiiFor(nodeId);
  const versions = await readVersions(storage, nodeId, org, id);
  const head = await readHead(storage, nodeId, org, id);
  if (!head && versions.length === 0) return null;
  const now = new Date().toISOString();
  const receipt: PurgeReceipt = {
    id, organism: org, openedAt: head?.openedAt ?? versions[0]?.at ?? now, endedAt: versions.at(-1)?.endedAt ?? null,
    purgedAt: now, versions: versions.length, basis,
  };
  await storage.createMemoryIfAbsent(record(nodeId, keys.receipt(org, id), receipt, now));
  const rows = await storage.listMemory(owner, { prefix: `kyc.org.${must(org)}.c.${must(id)}.` });
  await storage.bulkDeleteMemory(rows.map(r => ({ ownerGaii: owner, key: r.key })));
  await announce(storage, nodeId, org);
  return receipt;
}
