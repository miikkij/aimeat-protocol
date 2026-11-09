/**
 * @file src/services/csm/erased-lock-holders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node boot step for the schema locks of accounts erased before
 *   secaudit2026nov08 round 14 (approved by the developer on 2026-11-08).
 *
 *   WHY. Since round 14 an account erasure gives every schema lock the account, its agents or its
 *   ecosystem apps held the erasure's pseudonym (storage/erased-party.ts erasedPartyPseudonym; the
 *   cascades' schema-lock-erasure.ts). A lock is found by its key pattern and governs every account's
 *   writes under it, so it outlives its holder. A lock of an account erased BEFORE that change still
 *   names `alice`, `alice@<node>` or `bot#alice@<node>`, and an account registered later under the name
 *   holds it: it can replace or remove a lock that governs everybody's writes.
 *
 *   POSITIVE EVIDENCE ONLY (.claude/rules/backend.md: a migration that can hide data acts only on
 *   positive evidence, and anything ambiguous goes to the operator's page):
 *   - Moved: a lock whose holder is the bare name, `name@<this node>`, `<x>#name@<this node>` or an
 *     ecosystem app's `eco:<app>#name@<this node>` of an account that does not exist now. Never
 *     `system@<node>`, a reserved name (utils/gaii.ts RESERVED_NAMES, the operator's word among them),
 *     an `ext:` or `schedule:` principal, a holder of another node, or one that is `erased:` already. ONE pseudonym is drawn per missing
 *     name and written on all of that name's locks, as one erasure does. The lock keeps governing, no
 *     account matches its holder, and the operator still changes and removes it.
 *   - Asked: a lock whose holder's account exists now but was registered after the lock was set
 *     (the test of services/account-instance.ts heldSince). PostgreSQL keeps a lock's first set time
 *     when another holder saves it again, so this cannot be decided on evidence: nothing changes, and
 *     ONE incident on the Security page lists those locks, one entry each, with 'pseudonymise' (the
 *     lock was a previous holder's: it takes the pseudonym the incident drew for that name) or 'keep'
 *     (it is the current account's). The same decision is POST /v1/admin/security/incidents/:id/resolve
 *     { name: <entry id>, resolution }, the MCP tool aimeat_admin_incident_resolve and its CLI twin
 *     (services/incident-decisions.ts).
 *   - Left: every other lock, the live holders among them. A node whose locks are all live sees no
 *     change and no incident.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (ERASED_LOCK_HOLDERS_KEY, services/once-only-step.ts),
 *   before the node serves (server-bootstrap/once-only-keep-steps.ts), on both providers through the
 *   storage interface. Nothing throws on data: a lock that changed between the read and the write is
 *   left as it is, and a failed run leaves no record, so the next start tries again. The record keeps
 *   counts only, never an erased account's name.
 * @structure ERASED_LOCK_HOLDERS_KEY · ERASED_LOCK_INCIDENT_TYPE · lockHolderAccount() ·
 *   moveErasedLockHoldersOnce() · pseudonymiseLockEntry()
 * @usage await moveErasedLockHoldersOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.1.0 — 2026-11-08 — An ecosystem app's `eco:<app>#name@<node>` names its account, so an erased
 *     account's app locks move too, as the round-14 erasure moves them (developer, 2026-11-08).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14b, item C).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, SchemaRecord } from '../../storage/interface.js';
import { localAccountOf, validateOwnerName } from '../../utils/gaii.js';
import { ERASED_PARTY_PREFIX, erasedPartyPseudonym } from '../../storage/erased-party.js';
import { logger } from '../../utils/logger.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { recordSecurityIncident, type IncidentEntry } from '../security-incident.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const ERASED_LOCK_HOLDERS_KEY = 'migrations.secaudit2026nov08.erased-lock-holders';

/** The incident's type, which services/incident-decisions.ts dispatches on. */
export const ERASED_LOCK_INCIDENT_TYPE = 'erased_lock_holders';

/** Principals that are not an account's, whatever follows the prefix. */
const NOT_AN_ACCOUNT = ['ext:', 'schedule:', ERASED_PARTY_PREFIX];

/** An ecosystem app's identity, `eco:<app>#name@<node>`: the app acts for that account. */
const ECO_PREFIX = 'eco:';

/**
 * The account name a lock holder names on this node, or null when it names none this step may act
 * on: another node's identity, a reserved name (system, operator and the rest), a principal of an
 * extension or a schedule, a pseudonym, or a value that is not an identity. An ecosystem app's
 * `eco:<app>#name@<node>` names the account it acts for, as an agent's GAII does, because the
 * round-14 erasure moves that form too (developer, 2026-11-08).
 */
export function lockHolderAccount(lockedBy: string, nodeId: string): string | null {
  let s = String(lockedBy ?? '');
  if (s.startsWith(ECO_PREFIX)) {
    if (!s.includes('#')) return null;
    s = s.slice(ECO_PREFIX.length);
  }
  if (!s || NOT_AN_ACCOUNT.some(p => s.startsWith(p))) return null;
  const hasAt = s.includes('@');
  if (s.includes('#') && !hasAt) return null;
  if (hasAt && !s.endsWith(`@${nodeId}`)) return null;
  const name = hasAt ? localAccountOf(s) : s;
  if (!name || name.includes('@') || name.includes('#') || name.includes(':')) return null;
  return validateOwnerName(name) === null ? name : null;
}

/** The entry id of a lock: its applyTo and its key pattern, which together are the lock's key. */
const entryIdOf = (l: Pick<SchemaRecord, 'applyTo' | 'keyPattern'>): string => `${l.applyTo}:${l.keyPattern}`;

/** One lock older than the account that holds its holder's name now, as an entry of the incident. */
function entryOf(l: SchemaRecord, account: string, registered: string, pseudonym: string): IncidentEntry {
  return {
    id: entryIdOf(l), kind: 'schema_lock', where: `${l.keyPattern} (${l.applyTo})`, action: 'pseudonymise', status: 'open',
    what: `the schema lock on ${l.keyPattern} (${l.applyTo}), held by ${l.lockedBy}, was set on ${l.setAt}; `
      + `the account ${account} that holds the name now was registered on ${registered}`,
    params: { pattern: l.keyPattern, applyTo: l.applyTo, holder: l.lockedBy, account, setAt: l.setAt, registered, pseudonym },
  };
}

/** Write `pseudonym` as the holder of one lock, only while it still names `holder`. Answers whether it did. */
async function renameLock(storage: Storage, l: Pick<SchemaRecord, 'keyPattern' | 'applyTo'>, holder: string, pseudonym: string): Promise<boolean> {
  const now = await storage.getSchema(l.keyPattern, l.applyTo);
  if (!now || now.lockedBy !== holder) return false;
  await storage.setSchema({ ...now, lockedBy: pseudonym, updatedAt: new Date().toISOString() });
  return true;
}

/**
 * Move the locks of erased accounts to one pseudonym per name, and name the locks that may be a
 * previous holder's in one Security page incident. Throws when a write fails, and then leaves no
 * record, so the next start tries again.
 * @returns what it did, or null on a node that ran the step before
 */
export async function moveErasedLockHoldersOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ names: number; moved: number; asked: IncidentEntry[] } | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, ERASED_LOCK_HOLDERS_KEY);
  if (!claim) return null;
  try {
    const accounts = new Map<string, { createdAt?: string } | null>();
    const gone = new Map<string, SchemaRecord[]>();
    const asked: Array<{ lock: SchemaRecord; account: string; registered: string }> = [];
    for (const l of await storage.listSchemas()) {
      const name = lockHolderAccount(l.lockedBy, config.nodeId);
      if (!name) continue;
      if (!accounts.has(name)) accounts.set(name, await storage.getOwner(name));
      const account = accounts.get(name);
      if (!account) { gone.set(name, [...(gone.get(name) ?? []), l]); continue; }
      const setAt = Date.parse(l.setAt);
      const registeredAt = Date.parse(account.createdAt ?? '');
      if (Number.isFinite(setAt) && Number.isFinite(registeredAt) && registeredAt > setAt) asked.push({ lock: l, account: name, registered: account.createdAt! });
    }

    let moved = 0;
    for (const locks of gone.values()) {
      const pseudonym = erasedPartyPseudonym();
      for (const l of locks) if (await renameLock(storage, l, l.lockedBy, pseudonym)) moved++;
    }

    // One pseudonym per name among the asked locks too, so the locks of one previous holder read as one party.
    const askedPseudonym = new Map<string, string>();
    const entries = asked.sort((a, b) => a.lock.setAt.localeCompare(b.lock.setAt)).map(a => {
      if (!askedPseudonym.has(a.account)) askedPseudonym.set(a.account, erasedPartyPseudonym());
      return entryOf(a.lock, a.account, a.registered, askedPseudonym.get(a.account)!);
    });
    if (entries.length) {
      await recordSecurityIncident(storage, config, {
        type: ERASED_LOCK_INCIDENT_TYPE,
        code: 'LOCKS_OLDER_THAN_HOLDER',
        actorGhii: `system@${config.nodeId}`,
        actorName: 'node',
        source: 'boot',
        detail: `${entries.length} schema lock(s) were set before the account that holds their holder's name now was registered. `
          + 'They may be that account\'s, or an earlier account\'s of the same name that was erased before 2026-11-08, whose locks then kept the name. '
          + 'A lock governs every account\'s writes under its key pattern, and its holder can replace or remove it. Nothing was changed. '
          + 'Decide each one: "pseudonymise" (the lock was a previous holder\'s: it stays in force, and no account holds it) or "keep" (it is the current account\'s), '
          + 'on the Security page, or with POST /v1/admin/security/incidents/{id}/resolve { "name": "<entry id>", "resolution": "pseudonymise" | "keep" }. '
          + 'The incident resolves with the last one.',
        params: { count: String(entries.length) },
        entries,
      });
      logger.warn(`${entries.length} schema lock(s) older than the account that holds their name need the operator's decision; see the Security page`);
    }
    if (moved) logger.info(`${moved} schema lock(s) of ${gone.size} erased account(s) now name the erasure's pseudonym`);
    await claim.finish({ at: new Date().toISOString(), names: gone.size, moved, asked: entries.length });
    return { names: gone.size, moved, asked: entries };
  } catch (err) {
    await claim.release();
    throw err;
  }
}

/**
 * The offered action of one entry (services/incident-entries.ts EntryActor): the lock was a previous
 * holder's, so it takes the pseudonym the incident drew for that name. Nothing changes when the lock
 * is gone or has another holder since the incident was opened.
 */
export async function pseudonymiseLockEntry(storage: Storage, _config: AimeatConfig, entry: IncidentEntry): Promise<string> {
  const p = entry.params ?? {};
  const pattern = String(p.pattern ?? '');
  const applyTo = p.applyTo === 'exact' ? 'exact' : 'prefix';
  const holder = String(p.holder ?? '');
  const pseudonym = String(p.pseudonym ?? '') || erasedPartyPseudonym();
  const now = await storage.getSchema(pattern, applyTo);
  if (!now) return 'the lock was gone already';
  if (now.lockedBy !== holder) return `the lock has another holder since (${now.lockedBy}), so nothing changed`;
  await storage.setSchema({ ...now, lockedBy: pseudonym, updatedAt: new Date().toISOString() });
  return `the lock on ${pattern} now names ${pseudonym}, and no account holds it`;
}
