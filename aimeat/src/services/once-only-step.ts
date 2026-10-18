/**
 * @file src/services/once-only-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record that says a once-per-node boot step has run, taken as a claim BEFORE the
 *   work. Every boot step of server-bootstrap/service-init.ts read its record, did the work when the
 *   record was missing and wrote it at the end, so two node processes that start together on one
 *   database both found it missing and both did the work (aimeat.io has run two processes on one
 *   database, services/scheduler-fire-claim.ts). The claim is the same record: a `running` value
 *   written with createMemoryIfAbsent (or setMemoryIfVersion over a lapsed claim), so of two processes
 *   exactly one gets it. The winner does the work and writes the step's own record over its claim on
 *   the claim's version (finish); a step that throws removes its claim (release), so the next start
 *   runs it again, as before.
 *
 *   A LAPSED CLAIM. A process that stops between the claim and finish leaves a `running` record. After
 *   ONCE_ONLY_LEASE_MS it counts as lapsed and the next start takes it over. Until then a restart skips
 *   the step and a later start runs it: a step that runs late is a smaller harm than one that runs
 *   twice. The steps take seconds.
 *
 *   The done record keeps the value each step always wrote, so whatever reads it reads it unchanged.
 * @structure ONCE_ONLY_LEASE_MS · OnceOnlyClaim · claimOnceOnlyStep(storage, owner, key, now?)
 * @usage
 *   const claim = await claimOnceOnlyStep(storage, `system@${nodeId}`, KEY);
 *   if (!claim) return { ran: false };
 *   try { ...work...; await claim.finish({ at, ... }); } catch (err) { await claim.release(); throw err; }
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (check:atomic-writes, the boot migration sites).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** How long a claim stands before another start may take it over. */
export const ONCE_ONLY_LEASE_MS = 15 * 60_000;

/** The value of a claim that is still running. A record without `state: 'running'` is a step that ran. */
interface RunningClaim { state: 'running'; claimId: string; claimedAt: string }

function runningClaim(value: unknown): RunningClaim | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<RunningClaim>;
  return v.state === 'running' && typeof v.claimId === 'string' && typeof v.claimedAt === 'string' ? v as RunningClaim : null;
}

/** What the process that won the claim holds. */
export interface OnceOnlyClaim {
  /** Write the step's record over the claim, on the claim's version. */
  finish(value: Record<string, unknown>): Promise<void>;
  /** Remove the claim after a failed run, so the next start runs the step again. */
  release(): Promise<void>;
}

/**
 * Claim the once-only step recorded under `owner`'s `key`. Null when it has run, or another process
 * holds a claim younger than ONCE_ONLY_LEASE_MS, or another process claimed it first.
 */
export async function claimOnceOnlyStep(storage: Storage, owner: string, key: string, now: number = Date.now()): Promise<OnceOnlyClaim | null> {
  const prior = await storage.getMemory(owner, key);
  if (prior) {
    const held = runningClaim(prior.value);
    if (!held) return null;
    if (Date.parse(held.claimedAt) + ONCE_ONLY_LEASE_MS > now) return null;
  }
  const claimId = randomUUID();
  const at = new Date(now).toISOString();
  const claim: MemoryRecord = {
    key, ownerGaii: owner, value: { state: 'running', claimId, claimedAt: at }, visibility: 'private', tags: ['migration'],
    // Never swept: a record that expired would run the step again at the next start.
    ttlHours: null, version: (prior?.version ?? 0) + 1, createdAt: prior?.createdAt ?? at, updatedAt: at,
  };
  // A storage without the conditional writes writes plainly, as these steps did before.
  const won = prior
    ? (storage.setMemoryIfVersion ? !!await storage.setMemoryIfVersion(claim, prior.version) : (await storage.setMemory(claim), true))
    : (storage.createMemoryIfAbsent ? !!await storage.createMemoryIfAbsent(claim) : (await storage.setMemory(claim), true));
  if (!won) return null;
  if (prior) logger.warn(`Boot step ${key}: a claim from ${runningClaim(prior.value)?.claimedAt} never finished; running the step now`);

  return {
    async finish(value: Record<string, unknown>): Promise<void> {
      const done: MemoryRecord = { ...claim, value, version: claim.version + 1, updatedAt: new Date().toISOString() };
      const written = storage.setMemoryIfVersion ? !!await storage.setMemoryIfVersion(done, claim.version) : (await storage.setMemory(done), true);
      // Only a takeover after the lease changes the claim, and that process writes its own record.
      if (!written) logger.warn(`Boot step ${key}: another process took the step over after its claim lapsed; its record stands`);
    },
    async release(): Promise<void> {
      const current = await storage.getMemory(owner, key);
      if (runningClaim(current?.value)?.claimId === claimId) await storage.deleteMemory(owner, key, owner);
    },
  };
}
