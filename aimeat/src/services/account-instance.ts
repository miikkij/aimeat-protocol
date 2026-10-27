/**
 * @file src/services/account-instance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the account that holds a name now is the account a record named earlier.
 *
 *   WHY. An account name is released for reuse when its account is erased (decision 2026-08-10,
 *   storage/erased-account-records.ts). A record that names a person by `name@node` and keeps no
 *   account id (an operator's beneficiary approval, an accountant grant, an agreement's counterparty)
 *   then names the next person to register the name. The erasure removes such entries from now on
 *   (services/name-bound-grants-erasure.ts); this check covers the entries an older erasure left: an
 *   account registered after the record named it is a later holder of the name, not the person the
 *   record is about (secaudit2026oct26).
 * @structure heldSince(storage, ghii, at)
 * @usage if (!await heldSince(storage, approval.ghii, approval.verifiedAt)) return unverified;
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26: beneficiary-release, accountant-access and
 *     compliance-agreements counterparty name reuse).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountOf } from '../utils/gaii.js';

/**
 * True when the account that holds the name in `ghii` (`name@node`) now was registered at or before
 * `at`. False when no account holds the name, or the one that does was registered after `at`. A
 * missing or unreadable `at`, or an account with no readable creation time, answers true: nothing
 * shows a change of person, and the check never takes a right away on a guess.
 */
export async function heldSince(storage: Storage, ghii: string, at: string | null | undefined): Promise<boolean> {
  // An identity of another node names no account here (localAccountOf answers null for it).
  const name = localAccountOf(ghii);
  if (!name) return false;
  const owner = await storage.getOwner(name);
  if (!owner) return false;
  const named = Date.parse(at ?? '');
  const registered = Date.parse(owner.createdAt ?? '');
  if (!Number.isFinite(named) || !Number.isFinite(registered)) return true;
  return registered <= named;
}
