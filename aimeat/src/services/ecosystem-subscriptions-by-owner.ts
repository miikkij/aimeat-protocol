/**
 * @file src/services/ecosystem-subscriptions-by-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node boot step that moves the ecosystem app event subscriptions from the
 *   one node-wide record of earlier nodes (system@{nodeId} `ecosystem.subscriptions`) to one record per
 *   owner (`ecosystem.subscriptions.of.{owner}`), so every subscription made before the update keeps
 *   delivering (secaudit2026oct31w2 round 12, ecosystem-subscriptions:node-wide-registry-unbounded-size).
 *
 *   WHY. Every memory write on the node read the whole node-wide record before it kept the writer's
 *   owner's entries, and any account could grow that record. services/ecosystem-events.ts now reads
 *   only the writer's owner's record.
 *
 *   POSITIVE EVIDENCE ONLY (.claude/rules/backend.md). An entry moves when it has the fields the emitter
 *   reads and its ownerGhii names an account of this node, which is exactly the entry the emitter could
 *   deliver before. It is added to that owner's list unless the list holds the same subscription
 *   already, and it leaves the node-wide record only after the owner's stored list is read back with
 *   it. An entry the step cannot place (another node's identity, a value that is no subscription) could
 *   never be delivered or listed; it stays in the node-wide record exactly as it was, and nothing reads
 *   that record on a write any more. The node-wide record is rewritten on the version that was read, and
 *   removed when nothing is left in it. A step that throws leaves no finished record and runs again at
 *   the next start.
 * @structure ECOSYSTEM_SUBSCRIPTIONS_MOVED_KEY · moveEcosystemSubscriptionsByOwnerOnce(storage, config)
 * @usage await moveEcosystemSubscriptionsByOwnerOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   2026-11-04 — setMemoryIfVersion called without a presence check: it is required on Storage
 *     (codebase analysis 2026-11-03, item D-e).
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 12).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import {
  LEGACY_SUBSCRIPTIONS_KEY, parseSubscriptions, subscriptionIdentity, subscriptionOwnerOf, updateOwnerSubscriptions,
  type EcosystemSubscription,
} from './ecosystem-events.js';
import { UNCHANGED } from './record-cas.js';

/** The record that says the node-wide subscription record was moved to the owners. */
export const ECOSYSTEM_SUBSCRIPTIONS_MOVED_KEY = 'migrations.ecosystem-subscriptions-by-owner';

/** Move the node-wide subscription record to one record per owner, once per node. */
export async function moveEcosystemSubscriptionsByOwnerOnce(
  storage: Storage, config: AimeatConfig,
): Promise<{ ran: boolean; moved: number; left: number }> {
  const system = `system@${config.nodeId}`;
  const claim = await claimOnceOnlyStep(storage, system, ECOSYSTEM_SUBSCRIPTIONS_MOVED_KEY);
  if (!claim) return { ran: false, moved: 0, left: 0 };
  try {
    const at = new Date().toISOString();
    const legacy = await storage.getMemory(system, LEGACY_SUBSCRIPTIONS_KEY);
    const entries: unknown[] = Array.isArray(legacy?.value) ? legacy.value as unknown[] : [];
    const placeable = new Set<unknown>(parseSubscriptions(entries));

    const byOwner = new Map<string, EcosystemSubscription[]>();
    for (const e of entries) {
      if (!placeable.has(e)) continue;
      const sub = e as EcosystemSubscription;
      const owner = subscriptionOwnerOf(sub.ownerGhii, config.nodeId);
      if (!owner) continue;
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), sub]);
    }

    const moved = new Set<unknown>();
    for (const [owner, subs] of byOwner) {
      const stored = await updateOwnerSubscriptions(storage, config.nodeId, owner, cur => {
        const have = new Set(cur.map(subscriptionIdentity));
        const add = subs.filter(s => !have.has(subscriptionIdentity(s)));
        return add.length ? [...cur, ...add] : UNCHANGED;
      });
      // Read back: an entry leaves the node-wide record only when the owner's list holds it.
      const held = new Set(stored.map(subscriptionIdentity));
      for (const s of subs) if (held.has(subscriptionIdentity(s))) moved.add(s);
    }

    const left = entries.filter(e => !moved.has(e));
    if (legacy && moved.size) {
      if (!left.length) {
        await storage.deleteMemory(system, LEGACY_SUBSCRIPTIONS_KEY, system);
      } else {
        // Only on the version read.
        const rest = { ...legacy, key: LEGACY_SUBSCRIPTIONS_KEY, value: left, version: legacy.version + 1, updatedAt: at };
        const written = !!await storage.setMemoryIfVersion(rest, legacy.version);
        if (!written) logger.warn('Ecosystem subscriptions: the node-wide record was not rewritten on the version read; it stays as it is');
      }
    }
    await claim.finish({ at, moved: moved.size, left: left.length, owners: byOwner.size });
    if (entries.length) {
      logger.info(`Ecosystem subscriptions: ${moved.size} moved to ${byOwner.size} owners, ${left.length} left in the node-wide record`);
    }
    return { ran: true, moved: moved.size, left: left.length };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
