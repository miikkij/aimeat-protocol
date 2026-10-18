/**
 * @file src/services/install-set-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One run at a time of one applied install set record (install-set-apply.ts
 *   applyInstallSet, install-bundle-owner.ts installSetForOwner), across node processes.
 *
 *   WHY. An apply reads the record of what an earlier run made, makes what is missing (organisms,
 *   members, welcome emails, packages) and writes the record at the end. Two applies of one set at
 *   the same moment (the operator route, MCP, the start-up apply, an owner's web page and their AI)
 *   both read the same record, both made what it did not list, and the later write lost the
 *   earlier's. The record is now CLAIMED before the work: `running` is written onto it with a
 *   compare-and-swap on its version (setMemoryIfVersion, createMemoryIfAbsent), so of two runs one
 *   goes on and the other is refused before it makes anything. The pattern of
 *   commerce/session-claim.ts. An in-process lock would not do: aimeat.io has run two node processes
 *   on one database (services/scheduler-fire-claim.ts).
 *
 *   A CLAIM ENDS. The run's last write removes it (finishRun), on success and on the failure paths
 *   that already wrote the record. A process that stopped mid-run leaves a claim that a later run
 *   takes over once it is older than RUN_CLAIM_MS.
 *
 *   THE LAST WRITE MERGES. finishRun writes on the version it read. When the record changed after the
 *   claim (a run that took over a claim older than RUN_CLAIM_MS), what each run made is kept: the
 *   per-item maps and the lists are merged, and the other run's claim stays.
 * @structure RUN_CLAIM_MS · RunClaim · RunRecord · claimRun() · finishRun()
 * @usage
 *   const claimed = await claimRun(storage, key, parse, () => newAppliedRecord(...));
 *   if (!claimed) return busy;
 *   // ... the run changes claimed.record ...
 *   await finishRun(storage, key, parse, claimed.record, claimed.claim);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (atomic-write round: applyInstallSet and installSetForOwner).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { CAS_ATTEMPTS } from './record-cas.js';
import { NS_INSTALL_SETS } from './install-set-trust.js';

/** How long a run's claim holds before a later run may take it over. */
export const RUN_CLAIM_MS = 30 * 60_000;

/** Which run holds the record, and since when. */
export interface RunClaim { id: string; since: string }

/** The fields of an applied record a claim and a merge read. */
export interface RunRecord {
    running?: RunClaim;
    runs: number;
    created_at: string;
    applied_at: string;
}

/** Per-item maps and lists of an applied record, merged when two runs both wrote it. */
const MAPS = ['organisms', 'packages', 'members', 'agents', 'app_grants'] as const;
const LISTS = ['secrets_given', 'accounts_created', 'welcomed'] as const;

const live = (claim: RunClaim | undefined, nowMs: number): boolean =>
    !!claim && nowMs - Date.parse(claim.since) < RUN_CLAIM_MS;

function stripClaim<T extends RunRecord>(value: T): T {
    const rest = { ...value };
    delete rest.running;
    return rest;
}

/** Write `value` on the version of `rec` (or create it); whether this writer won. */
async function writeOn(storage: Storage, key: string, rec: MemoryRecord | null, value: RunRecord, createdAt: string): Promise<boolean> {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
        key, ownerGaii: NS_INSTALL_SETS, value: value as unknown as MemoryRecord['value'], visibility: 'private', tags: ['install-set'],
        ttlHours: null, version: (rec?.version ?? 0) + 1, createdAt: rec?.createdAt ?? createdAt, updatedAt: now,
    };
    if (rec) return storage.setMemoryIfVersion ? !!(await storage.setMemoryIfVersion(record, rec.version)) : !!(await storage.setMemory(record));
    return storage.createMemoryIfAbsent ? !!(await storage.createMemoryIfAbsent(record)) : !!(await storage.setMemory(record));
}

/**
 * Claim the run of `key`: the stored record (or `fresh()` when there is none) with this run's claim
 * on it. Null when another run holds a live claim: that run is making the set now. The record
 * answered carries no claim; the run changes it and hands it to finishRun.
 */
export async function claimRun<T extends RunRecord>(
    storage: Storage, key: string, parse: (v: unknown) => T | null, fresh: () => T,
): Promise<{ record: T; claim: RunClaim } | null> {
    const claim: RunClaim = { id: randomUUID(), since: new Date().toISOString() };
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const rec = await storage.getMemory(NS_INSTALL_SETS, key);
        const cur = parse(rec?.value);
        if (live(cur?.running, Date.now())) return null;
        const base = stripClaim(cur ?? fresh());
        if (await writeOn(storage, key, rec, { ...base, running: claim }, base.created_at)) return { record: base, claim };
    }
    return null;
}

/** `ours` over `stored`, keeping what each run made and a claim that is not ours. */
function mergeRuns<T extends RunRecord>(stored: T, ours: T, claim: RunClaim): T {
    const a = stored as unknown as Record<string, unknown>;
    const b = ours as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...a, ...b };
    for (const m of MAPS) {
        if (a[m] || b[m]) out[m] = { ...((a[m] as object | undefined) ?? {}), ...((b[m] as object | undefined) ?? {}) };
    }
    for (const l of LISTS) {
        if (a[l] || b[l]) out[l] = [...new Set([...((a[l] as unknown[] | undefined) ?? []), ...((b[l] as unknown[] | undefined) ?? [])])];
    }
    out.runs = Math.max(stored.runs, ours.runs);
    if (stored.running && stored.running.id !== claim.id) out.running = stored.running;
    else delete out.running;
    return out as unknown as T;
}

/** The run's last write: `record` without the claim, merged onto the stored record if it changed. */
export async function finishRun<T extends RunRecord>(
    storage: Storage, key: string, parse: (v: unknown) => T | null, record: T, claim: RunClaim,
): Promise<void> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const rec = await storage.getMemory(NS_INSTALL_SETS, key);
        const cur = parse(rec?.value);
        const value = cur ? mergeRuns(cur, stripClaim(record), claim) : stripClaim(record);
        if (await writeOn(storage, key, rec, value, record.created_at)) return;
    }
    throw new Error(`install set record ${key} changed under every one of ${CAS_ATTEMPTS} attempts; apply the set again`);
}
