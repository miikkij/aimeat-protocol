/**
 * @file src/services/csm/readers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who a CSM (Community Service Manifest) belongs to and who may read it, for every code
 *   path that decides on a CSM record: the CSM service (services/csm-service.ts), the schema-lock rule
 *   (services/schema-lock-rule.ts), the memory write's lock check (services/schema-validator.ts) and the
 *   AI job's pre-check. It imports only the audience test and the storage types, so the low layers ask
 *   the same question the CSM routes ask without importing the CSM service.
 *
 *   Ruling 2 of 2026-11-07: a CSM the caller may not read answers as a missing one does. The lock row a
 *   CSM owns (its jsonSchemaKey, `csm.<name>`) carries its compiled schema, so that row follows the
 *   CSM's visibility too (csmLockHiddenFrom).
 * @structure isRegisteringAccount() · csmMayReadAs() · csmLockHiddenFrom() · csmOfKey() ·
 *   csmLockHiddenFromWriter() · writerAudienceAuth()
 * @usage
 *   if (await csmLockHiddenFromWriter(storage, key, lock.keyPattern, writerAudienceAuth(principal, targetGaii))) … // no lock for this writer
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: isRegisteringAccount and the read test moved here from csm-service.ts,
 *     unchanged, plus the lock test for a writer (secaudit2026nov08b round 15,
 *     csm-family-decided-by-name-not-registering-account, memory-write-violations-describe-unreadable-csm-lock).
 */
import type { Storage, CsmRecord } from '../../storage/interface.js';
import { parseAudience, audienceAllows, type AudienceAuth } from '../audience.js';
import { localAccountOf } from '../../utils/gaii.js';

/**
 * Whether `account` is the account that registered the CSM: the same name, and that name's account was
 * registered no later than the CSM. A deleted account's name is released for reuse (decision
 * 2026-08-10), so an account registered after the CSM is a later holder of the name, not its author
 * (secaudit2026nov08 round 14). No account record, or no readable time, answers by the name alone: a
 * signed-in caller always has an account, and the check never takes a right away on a guess.
 */
export async function isRegisteringAccount(storage: Storage, record: Pick<CsmRecord, 'registeredBy' | 'registeredAt'>, account: string | null | undefined): Promise<boolean> {
  if (!account || record.registeredBy !== account) return false;
  const named = Date.parse(record.registeredAt ?? '');
  if (!Number.isFinite(named)) return true;
  const holder = await storage.getOwner(account);
  const registered = Date.parse(holder?.createdAt ?? '');
  return !Number.isFinite(registered) || registered <= named;
}

/** May this caller (null: nobody signed in) read the CSM? The registering account always may. */
export async function csmMayReadAs(storage: Storage, record: CsmRecord, auth: AudienceAuth | null): Promise<boolean> {
  const audience = parseAudience(record.visibility ?? 'public') ?? { level: 'private' as const };
  if (audience.level === 'public') return true;
  if (!auth) return false;
  // Private names the registering account; a later holder of the name is not it.
  const ownerName = audience.level === 'private' && auth.owner === record.registeredBy
    && !(await isRegisteringAccount(storage, record, auth.owner)) ? undefined : record.registeredBy;
  return audienceAllows(storage, audience, auth, { ...(ownerName ? { ownerName } : {}) });
}

/**
 * Whether the lock row at `keyPattern` is the one a CSM owns (its jsonSchemaKey) and this caller may
 * not read that CSM. Such a row answers as no lock to that caller, as the missing CSM would.
 */
export async function csmLockHiddenFrom(storage: Storage, keyPattern: string, auth: AudienceAuth | null): Promise<boolean> {
  if (!keyPattern.startsWith('csm.')) return false;
  const record = await storage.getCsm(keyPattern.slice('csm.'.length));
  if (!record || record.jsonSchemaKey !== keyPattern) return false;
  return !(await csmMayReadAs(storage, record, auth));
}

/**
 * The registered CSM a memory key falls under (`csm.<name>` or a key below it), the longest name first,
 * or null for a key outside `csm.` or under no registered name.
 */
export async function csmOfKey(storage: Storage, key: string): Promise<CsmRecord | null> {
  if (!key.startsWith('csm.')) return null;
  const segments = key.slice('csm.'.length).split('.');
  for (let i = segments.length; i >= 1; i--) {
    const record = await storage.getCsm(segments.slice(0, i).join('.'));
    if (record) return record;
  }
  return null;
}

/**
 * Whether the lock at `lockPattern`, found for a write to `key`, answers as no lock to this writer: the
 * key falls under a CSM the writer may not read, and the lock is one under `csm.` (the CSM's own row, or
 * a row its registering account set under its keys). A CSM the caller may not read answers as a missing
 * one, and a missing CSM's keys hold none of its locks.
 */
export async function csmLockHiddenFromWriter(storage: Storage, key: string, lockPattern: string, auth: AudienceAuth | null): Promise<boolean> {
  if (!lockPattern.startsWith('csm.')) return false;
  const record = await csmOfKey(storage, key);
  return !!record && !(await csmMayReadAs(storage, record, auth));
}

/**
 * The reader a memory write is, for the CSM read test: the principal that writes, in the account whose
 * namespace the record lands in (services/write-target.ts resolved it to one the principal may write).
 */
export function writerAudienceAuth(principal: string, targetGaii: string, federated?: boolean): AudienceAuth {
  const owner = localAccountOf(targetGaii) ?? undefined;
  return { sub: principal, ...(owner ? { owner } : {}), ...(federated ? { federated: true } : {}) };
}
