/**
 * @file src/services/service-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-owner service namespace: records one service of this node keeps for an
 *   account, stored under `svc:<owner>@<node>` instead of the owner's own identity, and the typed
 *   helper `serviceRecords<T>(storage, prefix)` that is the one code path reading and writing them.
 *
 *   WHY. A record a service ACTS on (a payment hold, a verified name, a goal) has lived in the
 *   owner's own namespace, where an app grant and an agent writing as the owner also write. Each such
 *   prefix had to be added to SERVICE_OWNED_KEY_PREFIXES in utils/reserved-keys.ts, and every memory
 *   route had to refuse it; a prefix that was forgotten was a hole until an audit found it
 *   (codebase analysis 2026-11-03, security-architecture.md finding 2). A record in this namespace
 *   needs no list entry: no principal resolves to `svc:...` (an owner name and an agent name are
 *   lowercase letters, digits and hyphens, utils/gaii.ts), so no memory route writes there, the
 *   owner-scope reads (services/owner-memory.ts: the GHII, the agents, the ecosystem apps) never
 *   include it, and the routes that take a namespace from the caller refuse it
 *   (utils/own-door-keys.ts ownDoorRefusal, services/memory-bin.ts).
 *
 *   OWNERSHIP. The records are the account's. The account holder's data export
 *   (GET /v1/owners/:name/export) carries them beside the records of their own identity, and the
 *   account erasure removes them (services/owner-erasure.ts). A service record is always written
 *   `private`, so no public listing or public read reaches it.
 *
 *   MOVING A PREFIX HERE. A prefix whose records already exist in the owners' namespaces moves with
 *   moveServicePrefixOnce, a once-only boot step (AIMEAT-PURPOSE rule 6; services/once-only-step.ts,
 *   so two processes that start together run it once). The step copies each row, reads the copy
 *   back, and removes the old row only when the copy holds the same value; a row it cannot verify
 *   stays where it was. Until the step has finished, a helper made with `legacyOwnerNamespace`
 *   resolves a key the namespace does not hold yet from the owner's own namespace. Before a prefix
 *   moves, every way the owner sees its records today (GET /v1/memory, GET /v1/memory/:key, the
 *   exports, the quota) has to keep its answer: a record the owner reads through a memory route
 *   today cannot move here without changing that answer, because no memory route reads this
 *   namespace.
 * @structure ServiceRecords<T> · serviceRecords<T>(storage, prefix, opts?) · serviceMoveStepKey(prefix) ·
 *   moveServicePrefixOnce(storage, config, prefix); the namespace names are re-exported from
 *   utils/service-namespace.ts
 * @usage
 *   const holds = serviceRecords<Hold>(storage, 'example-holds.', { parse: parseHold });
 *   await holds.put(ownerGhii, id, hold); const hold = await holds.get(ownerGhii, id);
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B6).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { isValidGHII } from '../utils/gaii.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { serviceNamespaceOf, isServiceNamespace, SERVICE_NAMESPACE_PREFIX } from '../utils/service-namespace.js';

export { SERVICE_NAMESPACE_PREFIX, serviceNamespaceOf, isServiceNamespace, ownerOfServiceNamespace } from '../utils/service-namespace.js';

/** How many times put() reads and writes again when another writer changed the record in between. */
const PUT_ATTEMPTS = 5;

/** The node part of an account identity. */
function nodeOf(ownerGhii: string): string {
  return ownerGhii.slice(ownerGhii.lastIndexOf('@') + 1);
}

/** The once-only step record that says `prefix` has moved into the service namespaces. */
export function serviceMoveStepKey(prefix: string): string {
  return `migrations.service-records.${prefix}`;
}

/** True when the move step of `prefix` has finished on node `nodeId`. A running claim is not finished. */
async function prefixMoved(storage: Storage, nodeId: string, prefix: string): Promise<boolean> {
  const v = (await storage.getMemory(`system@${nodeId}`, serviceMoveStepKey(prefix)))?.value as { state?: unknown } | undefined;
  return !!v && v.state !== 'running';
}

/** One service's records of one kind. `key` is the part after the prefix. */
export interface ServiceRecords<T> {
  /** The value, or null when there is none (or `parse` refuses it). */
  get(ownerGhii: string, key: string): Promise<T | null>;
  /** Write the value, on the version read, so a concurrent writer is never overwritten unseen. */
  put(ownerGhii: string, key: string, value: T): Promise<void>;
  /** Every record of this kind the account holds, in key order. */
  list(ownerGhii: string): Promise<Array<{ key: string; value: T }>>;
  /** Remove one record. True when there was one. */
  delete(ownerGhii: string, key: string): Promise<boolean>;
}

export interface ServiceRecordsOptions<T> {
  /** Turns a stored value into a T, or null for a value that is not one. Default: the value as it is. */
  parse?: (value: unknown) => T | null;
  /**
   * The prefix has records in the owners' own namespaces that moveServicePrefixOnce has not moved
   * yet: until its step has finished, a key the service namespace does not hold is read from the
   * owner's own namespace.
   */
  legacyOwnerNamespace?: boolean;
}

/**
 * The records of `prefix` (ending in a dot, e.g. `example-holds.`) in each account's service
 * namespace. The one code path to them: check:trusted-keys counts the reads of a service-owned key
 * that do not come through here.
 */
export function serviceRecords<T>(storage: Storage, prefix: string, opts: ServiceRecordsOptions<T> = {}): ServiceRecords<T> {
  if (typeof prefix !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.$/.test(prefix)) {
    throw new Error(`A service record prefix is lowercase letters, digits, dots and hyphens and ends in a dot, not "${prefix}"`);
  }
  const parse = opts.parse ?? ((v: unknown) => v as T);
  const fullKey = (key: string): string => {
    if (typeof key !== 'string' || !key) throw new Error('A service record key is a non-empty string');
    return `${prefix}${key}`;
  };
  const legacyActive = async (ownerGhii: string): Promise<boolean> =>
    !!opts.legacyOwnerNamespace && !(await prefixMoved(storage, nodeOf(ownerGhii), prefix));

  return {
    async get(ownerGhii, key) {
      const k = fullKey(key);
      const own = await storage.getMemory(serviceNamespaceOf(ownerGhii), k);
      if (own) return parse(own.value);
      if (!(await legacyActive(ownerGhii))) return null;
      const old = await storage.getMemory(ownerGhii, k);
      return old ? parse(old.value) : null;
    },

    async put(ownerGhii, key, value) {
      const ns = serviceNamespaceOf(ownerGhii);
      const k = fullKey(key);
      for (let attempt = 0; attempt < PUT_ATTEMPTS; attempt++) {
        const at = new Date().toISOString();
        const existing = await storage.getMemory(ns, k);
        const record: MemoryRecord = {
          key: k, ownerGaii: ns, value: value as MemoryRecord['value'], visibility: 'private', tags: [], ttlHours: null,
          version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? at, updatedAt: at,
        };
        const written = existing
          ? await storage.setMemoryIfVersion(record, existing.version)
          : await storage.createMemoryIfAbsent(record);
        if (written) return;
      }
      throw new Error(`Service record ${k} kept changing while it was written; nothing was written`);
    },

    async list(ownerGhii) {
      const rows = await storage.listMemory(serviceNamespaceOf(ownerGhii), { prefix });
      const byKey = new Map<string, unknown>();
      if (await legacyActive(ownerGhii)) {
        for (const r of await storage.listMemory(ownerGhii, { prefix })) byKey.set(r.key, r.value);
      }
      // The service namespace wins over a copy the move step has not removed yet.
      for (const r of rows) byKey.set(r.key, r.value);
      const out: Array<{ key: string; value: T }> = [];
      for (const k of [...byKey.keys()].sort()) {
        const value = parse(byKey.get(k));
        if (value !== null) out.push({ key: k.slice(prefix.length), value });
      }
      return out;
    },

    async delete(ownerGhii, key) {
      const k = fullKey(key);
      const removed = await storage.deleteMemory(serviceNamespaceOf(ownerGhii), k, serviceNamespaceOf(ownerGhii));
      // A copy in the owner's namespace the move step has not removed yet would answer get() again.
      if (await legacyActive(ownerGhii) && await storage.getMemory(ownerGhii, k)) {
        return (await storage.deleteMemory(ownerGhii, k, serviceNamespaceOf(ownerGhii))) || removed;
      }
      return removed;
    },
  };
}

/**
 * Move every record of `prefix` held in an account's own namespace on this node into that account's
 * service namespace, once per node. Only adds: a row is copied with createMemoryIfAbsent, so a record
 * the service already wrote there is never overwritten; the old row is removed only after the copy
 * is read back with the same value. A row whose copy differs, or whose namespace is not an account
 * of this node, stays where it was and is counted as kept. Running it again does nothing: the step's
 * record says it ran.
 */
export async function moveServicePrefixOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, prefix: string,
): Promise<{ ran: boolean; moved: number; kept: number }> {
  serviceRecords(storage, prefix);   // the same prefix rule as the helper
  const system = `system@${config.nodeId}`;
  const claim = await claimOnceOnlyStep(storage, system, serviceMoveStepKey(prefix));
  if (!claim) return { ran: false, moved: 0, kept: 0 };
  try {
    const at = new Date().toISOString();
    let moved = 0;
    let kept = 0;
    // The service namespaces themselves are left out: what is there already is not moved again.
    for (const row of (await storage.listAllMemory({ prefix, archived: 'include', excludeOwnerPrefix: SERVICE_NAMESPACE_PREFIX })).items) {
      if (!row.key.startsWith(prefix) || isServiceNamespace(row.ownerGaii)) continue;
      if (!isValidGHII(row.ownerGaii) || nodeOf(row.ownerGaii) !== config.nodeId) { kept++; continue; }
      const ns = serviceNamespaceOf(row.ownerGaii);
      await storage.createMemoryIfAbsent({
        ...row, ownerGaii: ns, visibility: 'private', groupId: undefined, allowedOrigins: undefined,
        version: 1, updatedAt: at,
      });
      const copy = await storage.getMemory(ns, row.key);
      if (copy && stableStringify(copy.value) === stableStringify(row.value)) {
        await storage.deleteMemory(row.ownerGaii, row.key, system);
        moved++;
      } else {
        kept++;
      }
    }
    await claim.finish({ at, prefix, moved, kept });
    if (moved || kept) logger.info(`Service records ${prefix}: ${moved} moved to the service namespaces, ${kept} left where they were`);
    return { ran: true, moved, kept };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
