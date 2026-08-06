/**
 * @file src/services/finance/accountant-access.ts
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
 *   resolveFinanceOwner
 * @usage const owner = await resolveFinanceOwner(config, storage, req);
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 6.
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { FinanceError } from './errors.js';

const ACCOUNTANTS_KEY = 'finance.accountants';
const CLIENTS_KEY = 'finance.clients';
const NAME_RE = /^[a-z0-9_-]{1,60}$/i;

async function readList(storage: Storage, ownerGhii: string, key: string): Promise<string[]> {
  const rec = await storage.getMemory(ownerGhii, key);
  const value = rec?.value as { list?: unknown } | undefined;
  return Array.isArray(value?.list) ? (value!.list as string[]).filter((s) => typeof s === 'string') : [];
}

async function writeList(storage: Storage, ownerGhii: string, key: string, list: string[]): Promise<void> {
  const existing = await storage.getMemory(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value: { list }, visibility: 'private', tags: ['finance'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
}

/** Grants the accountant role to a local owner. Both sides of the pair are written. */
export async function grantAccountant(config: AimeatConfig, storage: Storage, granterGhii: string, accountantName: string): Promise<string[]> {
  if (!NAME_RE.test(accountantName)) throw new FinanceError('INVALID_ACCOUNTANT', 400, 'accountant must be a local owner name');
  const target = await storage.getOwner(accountantName);
  if (!target) throw new FinanceError('NOT_FOUND', 404, `Owner "${accountantName}" not found on this node`);
  const accountantGhii = `${accountantName}@${config.nodeId}`;
  if (accountantGhii === granterGhii) throw new FinanceError('INVALID_ACCOUNTANT', 422, 'You already read your own books');

  const accountants = await readList(storage, granterGhii, ACCOUNTANTS_KEY);
  if (!accountants.includes(accountantGhii)) {
    accountants.push(accountantGhii);
    await writeList(storage, granterGhii, ACCOUNTANTS_KEY, accountants);
  }
  const clients = await readList(storage, accountantGhii, CLIENTS_KEY);
  if (!clients.includes(granterGhii)) {
    clients.push(granterGhii);
    await writeList(storage, accountantGhii, CLIENTS_KEY, clients);
  }
  return accountants;
}

/** Revokes the role; the authoritative list is what enforces, the mirror just follows. */
export async function revokeAccountant(config: AimeatConfig, storage: Storage, granterGhii: string, accountantName: string): Promise<string[]> {
  const accountantGhii = `${accountantName}@${config.nodeId}`;
  const accountants = (await readList(storage, granterGhii, ACCOUNTANTS_KEY)).filter((g) => g !== accountantGhii);
  await writeList(storage, granterGhii, ACCOUNTANTS_KEY, accountants);
  const clients = (await readList(storage, accountantGhii, CLIENTS_KEY)).filter((g) => g !== granterGhii);
  await writeList(storage, accountantGhii, CLIENTS_KEY, clients);
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
    const authority = await readList(storage, clientGhii, ACCOUNTANTS_KEY);
    if (authority.includes(accountantGhii)) verified.push(clientGhii);
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
  const accountants = await readList(storage, targetGhii, ACCOUNTANTS_KEY);
  if (!accountants.includes(callerGhii)) {
    throw new FinanceError('ACCOUNTANT_ACCESS_DENIED', 403, `No accountant grant from "${ownerParam}"`);
  }
  return targetGhii;
}
