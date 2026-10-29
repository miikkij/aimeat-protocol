/**
 * @file src/services/finance/accountant-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The accountant role: an owner grants another LOCAL owner read-only access
 *   to their finance area (invoices, vouchers, VAT reports, exports) — nothing else, and
 *   never write. Storage is a two-sided memory-record pair, same discipline as the
 *   commerce hold books: `finance.accountants` under the GRANTING owner is authoritative;
 *   `finance.clients` under the accountant is a mirror for the multi-client listing and
 *   is always re-verified against the authority before being believed.
 *
 *   Read routes accept `?owner={name}`: resolveFinanceOwner() returns the caller's own
 *   bucket without the param, and the client's bucket only when the authoritative list
 *   names the caller — otherwise an explicit 403 ACCOUNTANT_ACCESS_DENIED (the grant is
 *   a named relationship, not a secret; hiding it behind 404 would only confuse the
 *   accountant whose grant was revoked). Mutation routes never take the param.
 *
 * @structure grantAccountant · revokeAccountant · listAccountants · listClients ·
 *   resolveFinanceOwner · removeAccountantEverywhere
 * @usage const owner = await resolveFinanceOwner(config, storage, req);
 * @version-history
 *   v1.3.0 — 2026-10-29 — uncertainAccountantEntries names the entries without a grant time whose holder
 *     the estimate cannot place, and confirmAccountantEntry dates one and records it as confirmed
 *     (`confirmedAt`) when the client allows it (accountant-grant-ask.ts; secaudit2026oct26 round 8c).
 *   v1.2.0 — 2026-10-27 — The list keeps when each entry was granted (grantedAt). An account registered
 *     after its entry was granted is a later holder of a released name and reads nothing; the account
 *     erasure takes the erased person off every list (removeAccountantEverywhere) (secaudit2026oct26,
 *     finance/accountant-access:grant-survives-erasure-rebinds-on-name-reuse).
 *   v1.1.0 — 2026-10-18 — Both lists are written on the version that was read (updateRecord), so a
 *     grant and a revoke at the same moment each apply to what the other wrote.
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 6.
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { FinanceError } from './errors.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { heldSince } from '../account-instance.js';
import { listAllMemoryPages } from '../../storage/memory-pages.js';
import { localAccountOf } from '../../utils/gaii.js';

const ACCOUNTANTS_KEY = 'finance.accountants';
const CLIENTS_KEY = 'finance.clients';
const NAME_RE = /^[a-z0-9_-]{1,60}$/i;

async function readList(storage: Storage, ownerGhii: string, key: string): Promise<string[]> {
  return listOf((await storage.getMemory(ownerGhii, key))?.value);
}

const listOf = (v: unknown): string[] => {
  const value = v as { list?: unknown } | undefined;
  return Array.isArray(value?.list) ? (value!.list as string[]).filter((s) => typeof s === 'string') : [];
};

/**
 * Change one list on the version that was read (record-cas.ts updateRecord): two grants, or a grant
 * and a revoke, at the same moment each apply to the list the other wrote. `edit` answers the new
 * list, or null to write nothing. Answers the list as stored.
 */
async function editList(
  storage: Storage, ownerGhii: string, key: string, edit: (list: string[]) => string[] | null, stamp?: { add?: string; at: string; confirmed?: boolean },
): Promise<string[]> {
  const parse = (v: unknown): { list: string[]; grantedAt?: Record<string, string>; confirmedAt?: Record<string, string> } =>
    ({ list: listOf(v), grantedAt: grantedAtOf(v), confirmedAt: datesOf(v, 'confirmedAt') });
  const stored = await updateRecord(storage, ownerGhii, key, parse, (cur) => {
    const next = edit([...cur.list]);
    if (!next && !stamp?.add) return UNCHANGED;
    const list = next ?? cur.list;
    // When each entry was granted, so a later holder of a released name is told apart (grantedToCurrentHolder).
    const grantedAt = Object.fromEntries(Object.entries(cur.grantedAt ?? {}).filter(([g]) => list.includes(g)));
    if (stamp?.add && list.includes(stamp.add)) grantedAt[stamp.add] = stamp.at;
    // When the client confirmed an entry older than grant times (accountant-grant-ask.ts).
    const confirmedAt = Object.fromEntries(Object.entries(cur.confirmedAt ?? {}).filter(([g]) => list.includes(g)));
    if (stamp?.add && stamp.confirmed && list.includes(stamp.add)) confirmedAt[stamp.add] = stamp.at;
    return { list, ...(Object.keys(grantedAt).length ? { grantedAt } : {}), ...(Object.keys(confirmedAt).length ? { confirmedAt } : {}) };
  }, { tag: 'finance' });
  return stored.list;
}

const datesOf = (v: unknown, field: string): Record<string, string> => {
  const g = (v as Record<string, unknown> | undefined)?.[field];
  return g && typeof g === 'object' && !Array.isArray(g)
    ? Object.fromEntries(Object.entries(g as Record<string, unknown>).filter(([, at]) => typeof at === 'string')) as Record<string, string>
    : {};
};

/**
 * The entries of a client's list that hold no grant time and whose current holder the estimate cannot
 * place: the account was registered after the list was first written and no later than its last write,
 * so the grant may have been made to it or to an earlier holder of the name. An account registered
 * after the last write reads nothing (an earlier holder's grant, grantedToCurrentHolder); one registered
 * when the list began holds every entry. Each answer carries the holder's registration time.
 */
export async function uncertainAccountantEntries(
  storage: Storage, rec: { value: unknown; createdAt: string; updatedAt: string },
): Promise<Array<{ accountant: string; registeredAt: string }>> {
  const granted = grantedAtOf(rec.value);
  const begun = Date.parse(rec.createdAt);
  const last = Date.parse(rec.updatedAt);
  const out: Array<{ accountant: string; registeredAt: string }> = [];
  for (const accountant of listOf(rec.value)) {
    if (granted[accountant]) continue;
    const name = localAccountOf(accountant);
    const owner = name ? await storage.getOwner(name) : null;
    const registered = Date.parse(owner?.createdAt ?? '');
    if (!owner || !Number.isFinite(registered) || !Number.isFinite(begun) || !Number.isFinite(last)) continue;
    if (registered > begun && registered <= last) out.push({ accountant, registeredAt: owner.createdAt });
  }
  return out;
}

/**
 * The client allowed an entry the estimate could not place: it is dated now and recorded as confirmed,
 * so the account that holds the name now reads the books from here on. False when the entry is gone.
 */
export async function confirmAccountantEntry(storage: Storage, clientGhii: string, accountantGhii: string): Promise<boolean> {
  const list = await editList(storage, clientGhii, ACCOUNTANTS_KEY, () => null, { add: accountantGhii, at: new Date().toISOString(), confirmed: true });
  return list.includes(accountantGhii);
}

const grantedAtOf = (v: unknown): Record<string, string> => {
  const g = (v as { grantedAt?: unknown } | undefined)?.grantedAt;
  return g && typeof g === 'object' && !Array.isArray(g)
    ? Object.fromEntries(Object.entries(g as Record<string, unknown>).filter(([, at]) => typeof at === 'string')) as Record<string, string>
    : {};
};

/**
 * Whether `accountantGhii` is on the client's authoritative list as the account that holds the name
 * now. An entry granted before that account was registered names an earlier holder of a released name
 * (secaudit2026oct26). An entry from before grant times were kept is dated by the list's last write.
 */
async function grantedToCurrentHolder(storage: Storage, clientGhii: string, accountantGhii: string): Promise<boolean> {
  const rec = await storage.getMemory(clientGhii, ACCOUNTANTS_KEY);
  if (!listOf(rec?.value).includes(accountantGhii)) return false;
  return heldSince(storage, accountantGhii, grantedAtOf(rec?.value)[accountantGhii] ?? rec?.updatedAt);
}

/**
 * Take an erased account off every client's accountant list. The grant was to that person, and the
 * name is released for reuse (services/name-bound-grants-erasure.ts). Answers how many lists changed.
 */
export async function removeAccountantEverywhere(storage: Storage, accountantGhii: string): Promise<number> {
  const { items } = await listAllMemoryPages(storage, { prefix: ACCOUNTANTS_KEY });
  let n = 0;
  for (const rec of items) {
    if (rec.key !== ACCOUNTANTS_KEY || !listOf(rec.value).includes(accountantGhii)) continue;
    await editList(storage, rec.ownerGaii, ACCOUNTANTS_KEY, (list) => list.filter((g) => g !== accountantGhii));
    n++;
  }
  return n;
}

/** Grants the accountant role to a local owner. Both sides of the pair are written. */
export async function grantAccountant(config: AimeatConfig, storage: Storage, granterGhii: string, accountantName: string): Promise<string[]> {
  if (!NAME_RE.test(accountantName)) throw new FinanceError('INVALID_ACCOUNTANT', 400, 'accountant must be a local owner name');
  const target = await storage.getOwner(accountantName);
  if (!target) throw new FinanceError('NOT_FOUND', 404, `Owner "${accountantName}" not found on this node`);
  const accountantGhii = `${accountantName}@${config.nodeId}`;
  if (accountantGhii === granterGhii) throw new FinanceError('INVALID_ACCOUNTANT', 422, 'You already read your own books');

  const accountants = await editList(storage, granterGhii, ACCOUNTANTS_KEY,
    (list) => (list.includes(accountantGhii) ? null : [...list, accountantGhii]), { add: accountantGhii, at: new Date().toISOString() });
  await editList(storage, accountantGhii, CLIENTS_KEY,
    (list) => (list.includes(granterGhii) ? null : [...list, granterGhii]));
  return accountants;
}

/** Revokes the role; the authoritative list is what enforces, the mirror just follows. */
export async function revokeAccountant(config: AimeatConfig, storage: Storage, granterGhii: string, accountantName: string): Promise<string[]> {
  const accountantGhii = `${accountantName}@${config.nodeId}`;
  const accountants = await editList(storage, granterGhii, ACCOUNTANTS_KEY, (list) => list.filter((g) => g !== accountantGhii));
  await editList(storage, accountantGhii, CLIENTS_KEY, (list) => list.filter((g) => g !== granterGhii));
  return accountants;
}

export async function listAccountants(storage: Storage, granterGhii: string): Promise<string[]> {
  return readList(storage, granterGhii, ACCOUNTANTS_KEY);
}

/**
 * The accountant's client list — the mirror, RE-VERIFIED against each client's
 * authoritative list so a stale mirror can never claim access that was revoked.
 */
export async function listClients(storage: Storage, accountantGhii: string): Promise<string[]> {
  const mirror = await readList(storage, accountantGhii, CLIENTS_KEY);
  const verified: string[] = [];
  for (const clientGhii of mirror) {
    if (await grantedToCurrentHolder(storage, clientGhii, accountantGhii)) verified.push(clientGhii);
  }
  return verified;
}

/**
 * Resolves which owner's finance bucket a READ request targets. Without ?owner= it is
 * the caller's own; with it, the authoritative grant list decides — 403 otherwise.
 */
export async function resolveFinanceOwner(config: AimeatConfig, storage: Storage, req: Request): Promise<string> {
  const callerGhii = `${req.auth!.owner}@${config.nodeId}`;
  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
  if (!ownerParam || `${ownerParam}@${config.nodeId}` === callerGhii) return callerGhii;
  if (!NAME_RE.test(ownerParam)) throw new FinanceError('INVALID_OWNER', 400, 'owner must be a local owner name');
  const targetGhii = `${ownerParam}@${config.nodeId}`;
  if (!await grantedToCurrentHolder(storage, targetGhii, callerGhii)) {
    throw new FinanceError('ACCOUNTANT_ACCESS_DENIED', 403, `No accountant grant from "${ownerParam}"`);
  }
  return targetGhii;
}
