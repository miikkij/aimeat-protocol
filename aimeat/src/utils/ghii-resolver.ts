/**
 * @file ghii-resolver.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's GHII: which HUMAN a call was made in the name of. A moderation verdict,
 *   a review, a package's author and an instance's owner are all that question, so they file under
 *   one identity however the person arrived — their own session, one of their agents, or an app
 *   acting on a grant they gave.
 *
 *   NOT THE SAME QUESTION AS `resolveIdentity`, AND THE TWO MUST NOT BE MERGED.
 *   `resolveIdentity(auth, nodeId)` says whose session this is, synchronously and without touching
 *   the database, and on an agent session the answer is the AGENT's own GAII — which is right,
 *   because an agent's data is the agent's. This one reads the owner's GHII record and so answers
 *   for the person behind the agent. Collapsing them would undo the security fix of 2026-08-23,
 *   where storing the raw principal made one human appear as two identities and doubled their
 *   reviews.
 *
 *   WHY IT TAKES THE NODE AND NOT A FALLBACK. Until 2026-09-12 the third parameter was a fallback
 *   identity supplied by the caller, and every route handed it `req.auth!.sub`. On an owner session
 *   that is the BARE ACCOUNT NAME, which is exactly the value CLAUDE.md says must never be filed
 *   under: data stored as `alice` instead of `alice@node-id` is not found again by list, search or
 *   update. Six of the twenty-six call sites had already noticed and were building
 *   `${owner}@${config.nodeId}` by hand at the call site. The helper builds it here instead, so no
 *   caller can pass a bare name: the node id is what a GHII is missing, and it is all this needs.
 *
 *   A MISSING RECORD IS ANSWERED, A BROKEN DATABASE IS NOT. Every GHII this node creates is
 *   `${username}@${config.nodeId}` (owner-provisioning.ts, register-login.ts, admin.ts, setup.ts),
 *   so composing that form for an owner who has no record yet — an imported account, an unfinished
 *   migration — gives the same string the record would have carried. A storage FAULT is a different
 *   thing and is no longer swallowed: the old `catch { return fallback }` answered a database error
 *   with the bare account name and told nobody, so a verdict could be filed under the wrong
 *   identity by a moment's disturbance. The error now propagates and the route answers 500.
 * @usage
 *   import { resolveGhii } from '../utils/ghii-resolver.js';
 *   const ghii = await resolveGhii(storage, req.auth!.owner, config);
 * @version-history
 *   v1.0.0 — 2026-03-15 — extracted from packages.ts, instances.ts, templates.ts
 *   v2.0.0 — 2026-09-12 — takes the node instead of a caller-supplied fallback identity, so the
 *     bare account name can no longer reach a stored record; the storage fault is no longer
 *     swallowed. wish-identity-gate-sees-resolveghii.
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/**
 * The GHII of the human this call acts for.
 *
 * @param ownerName the bare account name — `req.auth!.owner` on every principal type
 * @param node the node whose id a composed GHII carries; pass `config`
 * @throws whatever the storage layer throws. A database fault is not a missing record.
 */
export async function resolveGhii(
  storage: Storage,
  ownerName: string,
  node: Pick<AimeatConfig, 'nodeId'>,
): Promise<string> {
  const ghiiRecord = await storage.getGHIIByOwner(ownerName);
  return ghiiRecord?.ghii ?? `${ownerName}@${node.nodeId}`;
}
