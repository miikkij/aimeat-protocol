/**
 * @file src/services/compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the node keeps its data processing agreements and how one is read and changed
 *   (plan doc-mvmr4i2wdk0p, D1.1, D2.3). Who may do it is decided in compliance-agreements-access.ts;
 *   the operations are in compliance-agreements-ops.ts and compliance-agreements-sign.ts.
 *
 *   ONE RECORD PER AGREEMENT, of `system@<node>` as the other compliance documents are, under
 *   `compliance.agreement.<id>`. An agreement with its versions is one thing a person opens on its
 *   own, and several dozen of them in one value would pass the 1024 kB a value may hold. Every change
 *   is a conditional write (record-cas.ts updateRecord), so two writers never lose each other's step.
 *
 *   THE STATE IS DERIVED, NOT STORED. statusOf() reads the versions: the version in force, a newer
 *   one waiting, a notice whose objection period has run out. finalizeNotices() turns such a notice
 *   into the version in force on the next write, and the sweep does the same once an hour.
 * @structure AGREEMENT_PREFIX · agreementKey() · newAgreementId() · readAgreement() · listAgreements() ·
 *   writeNewAgreement() · updateAgreement() · inForce() · newest() · statusOf() · summaryOf() ·
 *   finalizeNotices() · historyEntry()
 * @usage const a = await updateAgreement(storage, nodeId, id, cur => ({ ...cur, ... }));
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.1, D2.3).
 */
import { randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { systemGhiiFor } from './compliance-register.js';
import { AgreementSchema, type Agreement, type AgreementStatus, type AgreementVersion } from './compliance-agreements-schemas.js';

export const AGREEMENT_PREFIX = 'compliance.agreement.';
const ID = /^dpa-[a-z0-9]{6,20}$/;

export const agreementKey = (id: string): string | null => (ID.test(id) ? `${AGREEMENT_PREFIX}${id}` : null);

export function newAgreementId(): string {
  return `dpa-${randomBytes(6).toString('hex')}`;
}

const parse = (v: unknown): Agreement | null => {
  const p = AgreementSchema.safeParse(v);
  if (!p.success && v) {
    logger.warn('agreements: a stored agreement does not read as one; it is left out', {
      id: (v as { id?: unknown }).id, issues: p.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return p.success ? p.data : null;
};

export async function readAgreement(storage: Storage, nodeId: string, id: string): Promise<Agreement | null> {
  const key = agreementKey(id);
  if (!key) return null;
  const rec = await storage.getMemory(systemGhiiFor(nodeId), key);
  return rec ? parse(rec.value) : null;
}

export async function listAgreements(storage: Storage, nodeId: string): Promise<Agreement[]> {
  const owner = systemGhiiFor(nodeId);
  const { items } = await storage.listAllMemory({ ownerPrefix: owner, prefix: AGREEMENT_PREFIX, limit: 2000, excludeVersionRows: true });
  const out: Agreement[] = [];
  for (const r of items) {
    if (r.ownerGaii !== owner || !r.key.startsWith(AGREEMENT_PREFIX)) continue;
    const a = parse(r.value);
    if (a) out.push(a);
  }
  return out.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}

export async function writeNewAgreement(storage: Storage, nodeId: string, a: Agreement): Promise<Agreement> {
  const key = agreementKey(a.id);
  if (!key) throw new Error('bad agreement id');
  // Refuse before the write: a record that would not read back is never stored.
  const checked = AgreementSchema.parse(a);
  const out = await updateRecord(storage, systemGhiiFor(nodeId), key, v => (v ? parse(v) : null),
    cur => { if (cur) throw new Error(`agreement ${a.id} exists`); return checked; },
    { tag: 'compliance', tags: ['compliance', 'agreement'], visibility: 'private' });
  emitChange('compliance');
  return out as Agreement;
}

/**
 * Change one agreement on its version. `fn` gets the stored agreement with any lapsed notice already
 * turned into the version in force; returning UNCHANGED writes nothing.
 */
export async function updateAgreement(
  storage: Storage, nodeId: string, id: string, fn: (cur: Agreement) => Agreement | typeof UNCHANGED,
): Promise<Agreement | null> {
  const key = agreementKey(id);
  if (!key) return null;
  let missing = false;
  const out = await updateRecord(storage, systemGhiiFor(nodeId), key, v => (v ? parse(v) : null), cur => {
    if (!cur) { missing = true; return UNCHANGED; }
    const next = fn(finalizeNotices(cur));
    if (next === UNCHANGED) return UNCHANGED;
    const checked = AgreementSchema.parse({ ...next, updatedAt: new Date().toISOString() });
    return checked;
  }, { tag: 'compliance', tags: ['compliance', 'agreement'], visibility: 'private' });
  if (missing) return null;
  emitChange('compliance');
  return out as Agreement;
}

export function historyEntry(by: string, event: string, detail?: string): Agreement['history'][number] {
  return { at: new Date().toISOString(), by, event, ...(detail ? { detail: detail.slice(0, 600) } : {}) };
}

/** The version in force: the newest signed one. */
export function inForce(a: Agreement): AgreementVersion | null {
  for (let i = a.versions.length - 1; i >= 0; i--) if (a.versions[i]!.status === 'signed') return a.versions[i]!;
  return null;
}

export function newest(a: Agreement): AgreementVersion {
  return a.versions[a.versions.length - 1]!;
}

/**
 * A notice whose objection period ended with no objection makes its version the one in force, and
 * the one before it superseded. Pure: the caller writes the result.
 */
export function finalizeNotices(a: Agreement, now = Date.now()): Agreement {
  const v = newest(a);
  if (v.status !== 'sent' || !v.notice || v.notice.objectedAt || Date.parse(v.notice.objectionUntil) > now) return a;
  const at = v.notice.objectionUntil;
  const versions = a.versions.map(x => {
    if (x.n === v.n) return { ...x, status: 'signed' as const, signedAt: at, effectiveFrom: at };
    return x.status === 'signed' ? { ...x, status: 'superseded' as const } : x;
  });
  return { ...a, versions, history: [...a.history, historyEntry('system', 'notice-lapsed', `Version ${v.n} is in force: no objection by ${at}.`)].slice(-500) };
}

/** The agreement's state as one word, the one the processor list, fleet and the page read. */
export function statusOf(a: Agreement, now = Date.now()): AgreementStatus {
  if (a.endedAt) return 'ended';
  const v = newest(finalizeNotices(a, now));
  if (inForce(a) && (v.status === 'signed' || v.status === 'superseded' || (v.status === 'sent' && v.notice))) return 'signed';
  if (inForce(a) && v.status === 'draft') return 'signed';
  return v.status === 'superseded' ? 'expired' : v.status;
}

/** A short view of an agreement for a list, the processor slot and fleet. */
export function summaryOf(a: Agreement): Record<string, unknown> {
  const f = inForce(a);
  const v = newest(a);
  return {
    id: a.id, status: statusOf(a), product: a.product, language: a.language, subject: a.subject,
    counterparty: { name: a.counterparty.name, account: a.counterparty.account ?? null, businessId: a.counterparty.businessId ?? null },
    external_ref: a.externalRef ?? null,
    version_in_force: f?.n ?? null, signed_at: f?.signedAt ?? null, effective_from: f?.effectiveFrom ?? null,
    newest_version: v.n, newest_status: v.status,
    waiting: v.status === 'review' ? 'operator' : v.status === 'sent' && !v.notice ? 'counterparty' : v.status === 'draft' ? 'operator' : null,
    notice: v.notice ?? null, ended_at: a.endedAt ?? null, deletion: a.deletion ?? null, updated_at: a.updatedAt,
  };
}
