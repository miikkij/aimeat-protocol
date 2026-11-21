/**
 * @file src/utils/node-seed-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one test for "this node's own seeder wrote this record": an installer, a schema
 *   lock, a registrant or a job creator that starts with `system@`.
 *
 *   WHY THE PREFIX AND NEVER THE WHOLE STRING. A seeder stamps `system@<nodeId>`, and a node id is
 *   configuration, not identity: it can be set after the first boot, changed by an operator, or come
 *   with a restored database. A record written under the earlier id is still the node's own. A
 *   comparison with `system@${config.nodeId}` reads it as a stranger's, and then every upgrade the
 *   seeder ships skips it and every fence that lets "the node's own" through shuts it out. That
 *   happened on an organisation node renamed after its first boot (measured 2026-09-14): 20 of its 34
 *   schema records kept the old lock, the stored manifest-format schema stayed three weeks behind the
 *   code, and every `backing: 'rows'` manifest was refused by a schema the build no longer shipped.
 *
 *   WHY THE PREFIX IS SAFE. `system` is a reserved account name (utils/gaii.ts RESERVED_NAMES), so no
 *   person's GHII starts with it, and an account install stores a bare account name, which carries no
 *   `@`. A person's schema lock is their GHII, stamped by `PUT /v1/memory/:key/schema`.
 *
 *   HOW TO SEE IT FROM OUTSIDE. `GET /v1/schemas` lists every lock; grouping by `locked_by` shows
 *   whether a node still holds records under a name it no longer uses. `GET /v1/memory/{key}/schema`
 *   needs no auth and returns `locked_by` with the schema, whose `$comment: aimeat-seed-vN` is its
 *   stored version.
 *
 *   A test holds the rule: test/unit/node-seed-lock.test.ts refuses a new equality comparison with
 *   `system@${…}` in src/.
 * @structure NODE_SEED_LOCK_PREFIX · nodeSeedLock(nodeId) · isNodeSeedLock(lock)
 * @usage if (isNodeSeedLock(existing.lockedBy)) { ...upgrade it and re-stamp with nodeSeedLock(config.nodeId) }
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial. One home for the prefix test that manifest-schema.ts carried as
 *     isSystemSeeded; the cortex visibility fence and the package composer compared the whole string.
 */

/** The prefix every node seeder's identity carries. */
export const NODE_SEED_LOCK_PREFIX = 'system@';

/** The identity this node's seeders write today. Compare with isNodeSeedLock, never with this. */
export function nodeSeedLock(nodeId: string): string {
  return `${NODE_SEED_LOCK_PREFIX}${nodeId}`;
}

/** Whether a lock, installer or registrant names this node's own seeder, under this node id or an earlier one. */
export function isNodeSeedLock(lock: string | null | undefined): boolean {
  return typeof lock === 'string' && lock.startsWith(NODE_SEED_LOCK_PREFIX);
}
