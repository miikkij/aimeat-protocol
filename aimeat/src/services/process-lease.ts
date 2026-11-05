/**
 * @file src/services/process-lease.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run-once work when more than one node process shares a database: which process is
 *   alive, which one holds a piece of work, and which one runs a timed sweep this round. Everything
 *   is a memory record in the node's own namespace (`system@<node>`, keys `lease.*`), written on the
 *   record's version (createMemoryIfAbsent, setMemoryIfVersion), so of two processes exactly one wins
 *   a claim. The once-only boot steps (once-only-step.ts) and the stored outbox (outbox.ts) claim the
 *   same way.
 *
 *   A PROCESS IS ITS NAME AND ITS BOOT. The name is the host and the port (`<hostname>:<port>`): two
 *   processes that serve at once have different ones, and a process that a restart replaces on the
 *   same host and port has the same one. The boot is drawn at each start. So a holder whose name is
 *   this process's name and whose boot is not this boot is this process's previous life, and it is
 *   dead: that is how a restart on one process takes back what the stopped process held at once, as
 *   it did before leases existed (test/e2e-ai-jobs.ts case 15).
 *
 *   THE PROCESS LEASE. Each process keeps `lease.process.<name>` with its boot and a time it is good
 *   until (PROCESS_LEASE_MS), renewed every PROCESS_RENEW_MS, and sets that time to now when it stops
 *   (releaseProcessLease, at the end of the stop). A holder of another name is alive while its
 *   process lease names its boot and has not run out. A process that is killed stops renewing, and
 *   PROCESS_LEASE_MS later its work is taken over.
 *
 *   HELD LEASES (takeHeldLease) belong to a process for as long as it is alive: the scheduler's
 *   start-up @activate run and a workflow run's lock. They need no renewal of their own.
 *
 *   SWEEP TICKS (claimSweepTick). A timed sweep runs in one process per round: the process claims the
 *   round before it runs. The sweep stays with the process that ran it last: a claim by another process
 *   blocks it for one and a half intervals, which that process renews at its every round, so the
 *   other process takes the sweep over only when the first one stops running it. A claim by this
 *   process's own name never blocks, so one process runs every sweep exactly when it did before.
 *
 *   FAILING OPEN. A claim that cannot be made because the database failed lets the work run, as the
 *   scheduler's cron claim does (scheduler-fire-claim.ts): a lost sweep is worse than a double one.
 *   A liveness read that fails counts the holder as alive, so nothing is taken over on an error.
 *
 *   ONE PROCESS OR SEVERAL (node.processes, AIMEAT_NODE_PROCESSES; decision 6a of 2026-11-05). The
 *   default is `single`: no other live process can exist, so no holder but this process in this start
 *   is alive, and a starting process takes every lease at once. Without it, a container recreated with
 *   a new hostname is a process of a new name: it waited up to PROCESS_LEASE_MS for the previous
 *   holder, skipped its @activate run meanwhile and took the AI jobs over after about 45 s. With
 *   `multiple` the rules above apply unchanged. The process lease is written in both modes, so a node
 *   switched to `multiple` at its next start finds every process named.
 * @structure ProcessRef · thisProcess · sameProcess · singleProcess · startProcessLease · processLeaseReady ·
 *   releaseProcessLease · holderAlive · otherProcessAlive · takeHeldLease · waitForHeldLease ·
 *   releaseHeldLease · claimSweepTick · claimedSweep · PROCESS_LEASE_MS · PROCESS_RENEW_MS
 * @usage
 *   await startProcessLease(storage, config);                     // at boot, before any claim
 *   if (await takeHeldLease(storage, config, 'scheduler.activate')) runActivateJobs();
 *   setInterval(claimedSweep(storage, config, 'memory-bin', HOUR, () => { void sweep(); }), HOUR);
 * @version-history
 *   v1.1.0 -- 2026-11-05 -- One process per node by default (singleProcess): holderAlive answers alive
 *     only for this process in this start, otherProcessAlive answers no, and a sweep's round is never
 *     left to another name; the active-plus-standby rules hold with node.processes = multiple
 *     (codebase analysis 2026-11-03, decision 6a of 2026-11-05).
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item HA 2.5-2.7, run-once work).
 */
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

/** How long a process lease stands without a renewal. */
export const PROCESS_LEASE_MS = 30_000;
/** How often a live process renews its lease. */
export const PROCESS_RENEW_MS = 10_000;

export const LEASE_PREFIX = 'lease.';
const PROCESS_PREFIX = `${LEASE_PREFIX}process.`;

/** A node process: its host and port, and the start it is in. */
export interface ProcessRef { name: string; boot: string }

interface ProcessLeaseValue { name: string; boot: string; until: string; startedAt: string }
interface HeldLeaseValue { name: string; boot: string; at: string }

type LeaseConfig = Pick<AimeatConfig, 'nodeId' | 'port' | 'nodeProcesses'>;

// process-local: the start this process is in; every process draws its own, which is the point.
const BOOT = randomUUID();

const systemOwner = (nodeId: string): string => `system@${nodeId}`;
const safeName = (name: string): string => name.replace(/[^A-Za-z0-9_.:-]/g, '_');
const processKey = (name: string): string => `${PROCESS_PREFIX}${safeName(name)}`;

/** This process, as a holder names it. */
export function thisProcess(config: Pick<AimeatConfig, 'port'>): ProcessRef {
    return { name: `${hostname()}:${config.port}`, boot: BOOT };
}

/**
 * Whether this node runs one process (node.processes is `single`, the default). Only the word
 * `multiple` allows several, so a config that does not name the setting keeps one process.
 */
export function singleProcess(config: Pick<AimeatConfig, 'nodeProcesses'>): boolean {
    return config.nodeProcesses !== 'multiple';
}

/** Whether two holders are the same process in the same start. */
export function sameProcess(a: ProcessRef | null | undefined, b: ProcessRef | null | undefined): boolean {
    return !!a && !!b && a.name === b.name && a.boot === b.boot;
}

function asRef(v: unknown): ProcessRef | null {
    const r = v as Partial<ProcessRef> | null | undefined;
    return r && typeof r.name === 'string' && typeof r.boot === 'string' ? { name: r.name, boot: r.boot } : null;
}

// ── the process lease ────────────────────────────────────────────────────────

interface Keeper { storage: Storage; config: LeaseConfig; me: ProcessRef; ready: Promise<void>; timer?: ReturnType<typeof setInterval>; startedAt: string }

/** One keeper per node this process serves (the multi-node E2E suites run several in one process). */
// process-local: this process's own lease keepers; other processes read the stored lease records.
const keepers = new Map<string, Keeper>();

async function writeProcessLease(k: Keeper, until: number): Promise<void> {
    const value: ProcessLeaseValue = { name: k.me.name, boot: k.me.boot, until: new Date(until).toISOString(), startedAt: k.startedAt };
    await updateRecord(k.storage, systemOwner(k.config.nodeId), processKey(k.me.name), v => v,
        // A renewal still on its way when the stop released the lease does not bring it back.
        () => (keepers.get(k.config.nodeId) === k ? value : UNCHANGED),
        { tag: 'lease' });
}

/**
 * Write this process's lease and renew it every PROCESS_RENEW_MS. Called once at boot, before the
 * first claim; a second call for the same node answers the first one's promise.
 */
export function startProcessLease(storage: Storage, config: LeaseConfig): Promise<void> {
    const existing = keepers.get(config.nodeId);
    if (existing && existing.storage === storage && existing.config.port === config.port) return existing.ready;
    // A node started again in the same process (an in-process test) keeps its lease on its new storage.
    if (existing?.timer) clearInterval(existing.timer);
    const k: Keeper = { storage, config, me: thisProcess(config), ready: Promise.resolve(), startedAt: new Date().toISOString() };
    keepers.set(config.nodeId, k);
    const renew = (): Promise<void> => writeProcessLease(k, Date.now() + PROCESS_LEASE_MS)
        .catch(err => { logger.warn('process lease: renewal failed', { name: k.me.name, error: String(err) }); });
    k.ready = renew();
    // process-local: this process renews its own lease; another process only reads it.
    k.timer = setInterval(() => { void renew(); }, PROCESS_RENEW_MS);
    k.timer.unref?.();
    return k.ready;
}

/** Resolves once this process's lease is written (at once on a node that keeps none, such as a unit test). */
export function processLeaseReady(config: Pick<AimeatConfig, 'nodeId'>): Promise<void> {
    return keepers.get(config.nodeId)?.ready ?? Promise.resolve();
}

/**
 * The process is stopping, at the very end of the stop: renew no more and mark the lease as run out,
 * so another process takes this one's work over now rather than PROCESS_LEASE_MS later.
 */
export async function releaseProcessLease(): Promise<void> {
    const all = [...keepers.values()];
    keepers.clear();
    for (const k of all) {
        if (k.timer) clearInterval(k.timer);
        await updateRecord(k.storage, systemOwner(k.config.nodeId), processKey(k.me.name), v => v,
            cur => {
                const held = cur as Partial<ProcessLeaseValue> | null | undefined;
                if (held?.boot !== k.me.boot) return UNCHANGED;
                return { ...held, until: new Date().toISOString() } as ProcessLeaseValue;
            },
            { tag: 'lease' }).catch(err => logger.warn('process lease: release failed', { name: k.me.name, error: String(err) }));
    }
}

/**
 * Whether the process `ref` names is alive. This process is; this process's previous life is not;
 * another process is while its lease names that start and has not run out. No holder at all (work
 * written before leases existed) is not alive. A read that fails answers alive. With one process
 * per node (singleProcess), only this process in this start is alive.
 */
export async function holderAlive(storage: Storage, config: LeaseConfig, ref: ProcessRef | null | undefined): Promise<boolean> {
    if (!ref) return false;
    const me = thisProcess(config);
    if (ref.name === me.name || singleProcess(config)) return sameProcess(ref, me);
    try {
        const v = (await storage.getMemory(systemOwner(config.nodeId), processKey(ref.name)))?.value as Partial<ProcessLeaseValue> | undefined;
        return !!v && v.boot === ref.boot && typeof v.until === 'string' && Date.parse(v.until) > Date.now();
    } catch (err) {
        logger.warn('process lease: liveness read failed; counting the holder as alive', { holder: ref.name, error: String(err) });
        return true;
    }
}

/**
 * Whether a process other than this one (another name) is alive on this node's database. Never, with
 * one process per node (singleProcess).
 */
export async function otherProcessAlive(storage: Storage, config: LeaseConfig): Promise<boolean> {
    if (singleProcess(config)) return false;
    const me = thisProcess(config);
    try {
        const rows = await storage.listMemory(systemOwner(config.nodeId), { prefix: PROCESS_PREFIX });
        const now = Date.now();
        return rows.some(r => {
            const v = r.value as Partial<ProcessLeaseValue> | null;
            return !!v && v.name !== me.name && typeof v.until === 'string' && Date.parse(v.until) > now;
        });
    } catch (err) {
        logger.warn('process lease: could not list the processes; counting another as alive', { error: String(err) });
        return true;
    }
}

// ── held leases ──────────────────────────────────────────────────────────────

function leaseRecord(owner: string, key: string, value: unknown, prior: MemoryRecord | null): MemoryRecord {
    const now = new Date().toISOString();
    return {
        key, ownerGaii: owner, value, visibility: 'private', tags: ['lease'], ttlHours: null,
        version: (prior?.version ?? 0) + 1, createdAt: prior?.createdAt ?? now, updatedAt: now,
    };
}

/**
 * Take the lease `lease.<name>` for this process. True when this process holds it now: it was free,
 * its holder is not alive, or this process already held it. False when a live process holds it, or
 * another process took it in the same moment. A storage without the conditional writes, or one that
 * fails, answers true (the work runs, as it did before leases).
 */
export async function takeHeldLease(storage: Storage, config: LeaseConfig, name: string): Promise<boolean> {
    if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) return true;
    const owner = systemOwner(config.nodeId);
    const key = `${LEASE_PREFIX}${name}`;
    const me = thisProcess(config);
    try {
        await processLeaseReady(config);
        const prior = await storage.getMemory(owner, key);
        const held = asRef(prior?.value);
        if (prior && sameProcess(held, me)) return true;
        if (prior && held && await holderAlive(storage, config, held)) return false;
        const value: HeldLeaseValue = { name: me.name, boot: me.boot, at: new Date().toISOString() };
        const rec = leaseRecord(owner, key, value, prior);
        return prior ? !!await storage.setMemoryIfVersion(rec, prior.version) : !!await storage.createMemoryIfAbsent(rec);
    } catch (err) {
        logger.warn(`process lease: could not take ${key}; going ahead`, { error: String(err) });
        return true;
    }
}

/**
 * takeHeldLease, waiting while a live process holds it. After `maxWaitMs` the work goes ahead with a
 * warning: a holder that keeps a short lock that long is stuck, and the caller's own lock in this
 * process still holds. One process never waits here, because nothing else holds its leases.
 */
export async function waitForHeldLease(storage: Storage, config: LeaseConfig, name: string, maxWaitMs = 2 * PROCESS_LEASE_MS): Promise<void> {
    const began = Date.now();
    let pause = 25;
    while (!await takeHeldLease(storage, config, name)) {
        if (Date.now() - began > maxWaitMs) {
            logger.warn(`process lease: ${LEASE_PREFIX}${name} is still held by another process after ${maxWaitMs} ms; going ahead`);
            return;
        }
        await new Promise(r => setTimeout(r, pause));
        pause = Math.min(pause * 2, 250);
    }
}

/** Give back `lease.<name>` when this process holds it. The record is removed, not binned. */
export async function releaseHeldLease(storage: Storage, config: LeaseConfig, name: string): Promise<void> {
    // takeHeldLease wrote nothing on such a storage, so there is nothing to give back.
    if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) return;
    const owner = systemOwner(config.nodeId);
    const key = `${LEASE_PREFIX}${name}`;
    try {
        const prior = await storage.getMemory(owner, key);
        if (!prior || !sameProcess(asRef(prior.value), thisProcess(config))) return;
        if (storage.bulkDeleteMemory) await storage.bulkDeleteMemory([{ ownerGaii: owner, key }]);
        else await storage.deleteMemory(owner, key, owner);
    } catch (err) {
        logger.warn(`process lease: could not release ${key}`, { error: String(err) });
    }
}

// ── sweep ticks ──────────────────────────────────────────────────────────────

/** How many intervals a sweep stays with the process that ran it last before another one takes it. */
export const SWEEP_KEEP_ROUNDS = 1.5;

/**
 * Claim this round of the sweep `name`, which runs every `intervalMs`. True: run it. False: another
 * process ran it less than SWEEP_KEEP_ROUNDS intervals ago (so it is alive and keeps the sweep), or
 * took it in the same moment. With one process per node (singleProcess) every round is this
 * process's, whichever name ran it last.
 */
export async function claimSweepTick(storage: Storage, config: LeaseConfig, name: string, intervalMs: number): Promise<boolean> {
    if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) return true;
    const owner = systemOwner(config.nodeId);
    const key = `${LEASE_PREFIX}sweep.${name}`;
    const me = thisProcess(config);
    try {
        await processLeaseReady(config);
        const prior = await storage.getMemory(owner, key);
        const held = prior?.value as Partial<HeldLeaseValue> | undefined;
        const mine = held?.name === me.name || singleProcess(config);
        if (prior && !mine && typeof held?.at === 'string' && Date.now() - Date.parse(held.at) < SWEEP_KEEP_ROUNDS * intervalMs) return false;
        const value: HeldLeaseValue = { name: me.name, boot: me.boot, at: new Date().toISOString() };
        const rec = leaseRecord(owner, key, value, prior);
        const won = prior ? !!await storage.setMemoryIfVersion(rec, prior.version) : !!await storage.createMemoryIfAbsent(rec);
        // This process's own name runs whatever the write did: one process never skips a round.
        if (won || mine) return true;
        const winner = (await storage.getMemory(owner, key))?.value as Partial<HeldLeaseValue> | undefined;
        return winner?.name === me.name;
    } catch (err) {
        logger.warn(`process lease: could not claim the sweep ${name}; running it`, { error: String(err) });
        return true;
    }
}

/** A timer callback that runs `run` only when this process claims the round (claimSweepTick). */
export function claimedSweep(storage: Storage, config: LeaseConfig, name: string, intervalMs: number, run: () => void): () => void {
    return () => {
        void claimSweepTick(storage, config, name, intervalMs).then(claimed => {
            if (claimed) run();
            else logger.info(`Sweep ${name}: another node process runs this round`);
        });
    };
}
