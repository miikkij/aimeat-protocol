/**
 * @file src/services/csm/csm-lock-holders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node boot step for the schema locks under `csm.` that an account other
 *   than the CSM's registering account holds since before secaudit2026nov08b round 15 (deferred unit D1).
 *
 *   WHY. A lock is found by its key pattern and governs every account's writes under it, and the lock at a
 *   CSM's own key (`csm.<name>`) is also what GET /v1/csm/{name}, aimeat_csm and getCsmCompiled serve as
 *   the CSM's schema, which other accounts' new receivers copy. Since round 14 (rule 5,
 *   services/schema-lock-rule.ts) only the registering account, its agents and the operator set a lock
 *   on a pattern that reaches a CSM, and since round 15 that means the registering account and not a
 *   later account of an erased author's name. Rows set before either rule keep their holder:
 *     - a lock another account set on `csm.<name>` before the CSM was registered, which createCsmAs then
 *       kept as the holder until round 14 (it moves to the registering account only on the next
 *       PUT /v1/csm), and the same on a package-installed CSM, which never gets a lock row of its own;
 *     - an exact or a wildcard row another account set under a CSM's keys, which the lookup ranks above
 *       the CSM's own prefix row, so the writes under those keys are checked against it;
 *     - a lock a later account of an erased installer's name set on that installer's package CSM.
 *   Such a holder cannot change these rows any more (rule 5 on PUT, csmLockRemovalRefusal on DELETE),
 *   and the registering account cannot either, because it does not hold them.
 *
 *   POSITIVE EVIDENCE ONLY (.claude/rules/backend.md): the CSM record names its registering account and
 *   when it was registered, and the account record says when the account that holds that name now was
 *   registered (csm/readers.ts isRegisteringAccount). The lock's content never changes: every row keeps
 *   governing with the schema it holds, so nothing is hidden. Only the holder changes:
 *   - Left: a row that names a CSM and whose holder is the registering account of every CSM it reaches (its bare name, GHII,
 *     agent or ecosystem app; with no readable time the name alone decides, as on the routes), the
 *     node's seeder (`system@`), an erasure pseudonym, the operator's account, or a principal that names
 *     no account of this node (an extension, a schedule, another node, a reserved name).
 *   - Given to the registering account: a row whose holder is not it, when every CSM the row reaches
 *     names the same account and that account is the registering one now. That account gets a notice
 *     naming the lock, so it can keep, change or remove it.
 *   - Given an erasure pseudonym: every other such row (a pattern over every CSM, which rule 5 names the
 *     operator's; or the CSMs it reaches name the seeder, more than one account, or an account that is
 *     gone or was registered after the CSM). ONE pseudonym per
 *     previous holder's account, as one erasure draws. The lock keeps governing, no account holds it, the
 *     operator still changes and removes it, and the registering account takes it over on its next
 *     PUT /v1/csm (csm-service.ts lockSchema).
 *   Nothing here is ambiguous enough to need the operator: every row this step changes keeps its
 *   content, and a row it cannot judge is left. So it opens no Security page incident.
 *
 *   WHEN. Once, recorded under `system@<nodeId>` (CSM_LOCK_HOLDERS_KEY, services/once-only-step.ts),
 *   before the node serves, after moveErasedLockHoldersOnce (server-bootstrap/once-only-keep-steps.ts),
 *   on both providers through the storage interface. A row that changed between the read and the write
 *   is left as it is, and a failed run leaves no record, so the next start tries again. The record keeps
 *   counts only, never a holder's name.
 * @structure CSM_LOCK_HOLDERS_KEY · moveCsmLockHoldersOnce()
 * @usage await moveCsmLockHoldersOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15, D1).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, SchemaRecord, CsmRecord, OwnerRecord } from '../../storage/interface.js';
import { ERASED_PARTY_PREFIX, erasedPartyPseudonym } from '../../storage/erased-party.js';
import { isOperatorAccount } from '../../utils/operator-account.js';
import { logger } from '../../utils/logger.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { notify } from '../notify.js';
import { lockHolderAccount } from './erased-lock-holders.js';
import { isRegisteringAccount } from './readers.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const CSM_LOCK_HOLDERS_KEY = 'migrations.secaudit2026nov08b.csm-lock-holders';

/**
 * The CSMs of `all` a pattern under `csm.` reaches, as rule 5 reads it (schema-lock-rule.ts
 * csmsReachedBy), and whether it reaches every CSM (no literal name before its first wildcard), which
 * rule 5 names the operator's.
 */
function reachedBy(all: CsmRecord[], keyPattern: string): { csms: CsmRecord[]; everyCsm: boolean } {
  const segments = keyPattern.slice('csm.'.length).split('.');
  const firstWild = segments.findIndex(s => /\*/.test(s));
  const literal = firstWild < 0 ? segments : segments.slice(0, firstWild);
  if (literal.length === 0) return { csms: all, everyCsm: true };
  const name = literal.join('.');
  return { csms: all.filter(c => c.name === name || c.name.startsWith(`${name}.`) || name.startsWith(`${c.name}.`)), everyCsm: false };
}

/** Write `lockedBy` as the holder of one lock, only while it still names `was`. Answers whether it did. */
async function rehold(storage: Storage, l: SchemaRecord, was: string, lockedBy: string, setAt?: string): Promise<boolean> {
  const now = await storage.getSchema(l.keyPattern, l.applyTo);
  if (!now || now.lockedBy !== was) return false;
  await storage.setSchema({ ...now, lockedBy, ...(setAt ? { setAt } : {}), updatedAt: new Date().toISOString() });
  return true;
}

/** Tell the registering account a lock under its CSM is its own now. Never throws. */
async function tellRegistrant(storage: Storage, nodeId: string, account: string, csm: string, pattern: string): Promise<void> {
  try {
    await notify(storage, `${account}@${nodeId}`, {
      type: 'csm_lock_yours',
      title: `A lock on your data description ${csm} is yours now`,
      body: `Another account held the lock on ${pattern}, under your data description (CSM) ${csm}, from before this server checked who may lock it. You hold it now. `
        + 'Every write under that key is still checked against the shape the lock holds. If that shape is not yours, '
        + `save your description again (PUT /v1/csm/${csm}), or remove the lock (DELETE /v1/memory/${pattern}/schema).`,
      i18n: { key: 'csm_lock_yours', vars: { csm, pattern } },
    });
  } catch (err) {
    logger.warn('csm-lock-holders: the notice to the registering account failed', { pattern, error: String(err) });
  }
}

/**
 * Give the rows under `csm.` that an account other than the registering one holds to that account, or
 * an erasure pseudonym. Throws when a write fails, and then leaves no record, so the next start tries again.
 * @returns what it did, or null on a node that ran the step before
 */
export async function moveCsmLockHoldersOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ given: number; pseudonymised: number } | null> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, CSM_LOCK_HOLDERS_KEY);
  if (!claim) return null;
  try {
    const csms = await storage.listCsms();
    const accounts = new Map<string, OwnerRecord | null>();
    const accountOf = async (name: string) => {
      if (!accounts.has(name)) accounts.set(name, await storage.getOwner(name));
      return accounts.get(name)!;
    };
    const pseudonyms = new Map<string, string>();
    let given = 0, pseudonymised = 0;
    for (const l of csms.length ? await storage.listSchemas('csm.') : []) {
      if (!l.keyPattern.startsWith('csm.') || l.lockedBy.startsWith('system@') || l.lockedBy.startsWith(ERASED_PARTY_PREFIX)) continue;
      const { csms: reached, everyCsm } = reachedBy(csms, l.keyPattern);
      if (reached.length === 0) continue;
      const holder = lockHolderAccount(l.lockedBy, config.nodeId);
      if (!holder) continue;
      const held = await accountOf(holder);
      if (held && isOperatorAccount(held)) continue;
      // A pattern over every CSM reaches the CSMs registered after it too, so no one account holds it rightly.
      let rightful = !everyCsm;
      if (rightful) for (const c of reached) if (!(await isRegisteringAccount(storage, c, holder))) { rightful = false; break; }
      if (rightful) continue;

      // A pattern over every CSM is the operator's (rule 5), never one registering account's.
      const names = new Set(reached.map(c => c.registeredBy));
      const only = !everyCsm && names.size === 1 ? reached[0]!.registeredBy : null;
      const registrant = only && lockHolderAccount(only, config.nodeId) === only && await accountOf(only)
        && (await Promise.all(reached.map(c => isRegisteringAccount(storage, c, only)))).every(Boolean) ? only : null;
      if (registrant) {
        if (await rehold(storage, l, l.lockedBy, registrant, new Date().toISOString())) {
          given++;
          const own = reached.find(c => c.jsonSchemaKey === l.keyPattern) ?? reached[0]!;
          await tellRegistrant(storage, config.nodeId, registrant, own.name, l.keyPattern);
        }
        continue;
      }
      if (!pseudonyms.has(holder)) pseudonyms.set(holder, erasedPartyPseudonym());
      if (await rehold(storage, l, l.lockedBy, pseudonyms.get(holder)!)) pseudonymised++;
    }
    if (given || pseudonymised) {
      logger.warn(`${given} schema lock(s) under csm. now name the CSM's registering account, and ${pseudonymised} an erasure pseudonym; their content is unchanged`);
    }
    await claim.finish({ at: new Date().toISOString(), given, pseudonymised });
    return { given, pseudonymised };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
