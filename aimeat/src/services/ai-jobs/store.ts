/**
 * @file src/services/ai-jobs/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an AI job lives, and — the part that matters — where it stops living.
 *
 *   A LIVE job (`queued` / `running`) is one memory record at `ai.jobs.<id>` in the owner's
 *   namespace. On reaching a terminal state it is FOLDED into `ai.jobs.log.<YYYY-MM-DD>`, an array
 *   of finished-job summaries, and the live key is DELETED.
 *
 *   That is not tidiness, it is the difference between a feature that works and one that stops the
 *   node. A principal holds 1000 memory keys by default (`AIMEAT_MEMORY_MAX_KEYS`, config.ts), and
 *   the house rule is that if `keys_per_day × 365` exceeds 1000 the shape is wrong. A tool called a
 *   few times an hour fills the ceiling in weeks. `workflows.run.<id>.<runId>` has exactly this
 *   defect today, which is why it is specified here rather than discovered later.
 *
 *   The per-day log record is itself bounded: a memory value may hold 1024 kB, so a day that
 *   overflows drops its OLDEST entries and says so in the log. A silent truncation would read as
 *   "everything is here" when it is not.
 * @structure liveKey · logKeyFor · readJob · writeJob · deleteJob · listLiveJobs · foldIntoLog ·
 *   findInLogs · pruneLogs · readActiveIndex · addToActiveIndex · removeFromActiveIndex
 * @usage import { writeJob, foldIntoLog } from './store.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import type { AiJobRecord, AiJobLogEntry } from './types.js';

export const AI_JOB_KEY_PREFIX = 'ai.jobs.';
export const AI_JOB_LOG_PREFIX = 'ai.jobs.log.';

/** Headroom under the 1024 kB per-value ceiling, so a day's log leaves room for its own growth. */
const LOG_MAX_BYTES = 900_000;

export const liveKey = (jobId: string): string => `${AI_JOB_KEY_PREFIX}${jobId}`;
export const logKeyFor = (day: string): string => `${AI_JOB_LOG_PREFIX}${day}`;
export const dayOf = (iso: string): string => iso.slice(0, 10);

const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;
/** One key naming every live job on the node, so a restart can find what the dead process left
 *  running without walking every owner's namespace. Mirrors the workflow engine's active-run index. */
const ACTIVE_INDEX_KEY = 'ai.jobs.active';

async function upsert(
    storage: Storage, gaii: string, key: string, value: unknown, tags: string[],
): Promise<void> {
    const existing = await storage.getMemory(gaii, key);
    const now = new Date().toISOString();
    await storage.setMemory({
        key, ownerGaii: gaii, value, visibility: 'private', tags, ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}

// ── the live record ───────────────────────────────────────────────────────────

export async function readJob(storage: Storage, ownerGhii: string, jobId: string): Promise<AiJobRecord | null> {
    const rec = await storage.getMemory(ownerGhii, liveKey(jobId));
    return (rec?.value as AiJobRecord | undefined) ?? null;
}

export async function writeJob(storage: Storage, job: AiJobRecord): Promise<void> {
    await upsert(storage, job.owner, liveKey(job.id), job, ['ai', 'ai-job']);
}

export async function deleteJob(storage: Storage, ownerGhii: string, jobId: string): Promise<void> {
    await storage.deleteMemory(ownerGhii, liveKey(jobId));
}

/**
 * Every live job in one owner's namespace. The log records share the `ai.jobs.` prefix, so they are
 * filtered out by name rather than by hoping the listing is exact.
 */
export async function listLiveJobs(storage: Storage, ownerGhii: string): Promise<AiJobRecord[]> {
    const records = await storage.listMemory(ownerGhii, { prefix: AI_JOB_KEY_PREFIX });
    return records
        .filter(r => !r.key.startsWith(AI_JOB_LOG_PREFIX))
        .map(r => r.value as AiJobRecord)
        .filter((v): v is AiJobRecord => !!v && typeof v.id === 'string' && typeof v.state === 'string');
}

// ── the fold ──────────────────────────────────────────────────────────────────

/** Strip what the log does not keep. The answer is at `result_key`; the prompt that asked for it can
 *  be a megabyte, and a day of megabytes does not fit in one record. */
function summarise(job: AiJobRecord): AiJobLogEntry {
    const rest = { ...job } as Partial<AiJobRecord>;
    delete rest.prompt;
    delete rest.input_keys;
    delete rest.system_prompt;
    return rest as AiJobLogEntry;
}

/**
 * Fold a finished job into its day's log and delete the live key. THE live key must go: see the
 * file header for what a key per run costs.
 *
 * The fold happens first and the delete second. In the other order a crash between them loses the
 * job entirely; in this one it leaves a live record that the next restart reconciles, which is a
 * duplicate rather than a hole.
 */
export async function foldIntoLog(storage: Storage, job: AiJobRecord): Promise<void> {
    const day = dayOf(job.finished_at ?? new Date().toISOString());
    const key = logKeyFor(day);
    const existing = await storage.getMemory(job.owner, key);
    const entries = Array.isArray(existing?.value) ? (existing.value as AiJobLogEntry[]) : [];

    entries.push(summarise(job));

    // Bound the day. Oldest first out, and SAID OUT LOUD: a cap nobody is told about reads as
    // "everything is here".
    let dropped = 0;
    while (entries.length > 1 && Buffer.byteLength(JSON.stringify(entries), 'utf8') > LOG_MAX_BYTES) {
        entries.shift();
        dropped++;
    }
    if (dropped > 0) {
        logger.warn(`[ai-jobs] ${key} is full: dropped ${dropped} of the oldest entries to stay under the per-value ceiling`, {
            owner: job.owner, day,
        });
    }

    await upsert(storage, job.owner, key, entries, ['ai', 'ai-job-log']);
    await deleteJob(storage, job.owner, job.id);
}

/** Find a finished job by id across the retained day logs (newest day first). */
export async function findInLogs(storage: Storage, ownerGhii: string, jobId: string): Promise<AiJobLogEntry | null> {
    const records = await storage.listMemory(ownerGhii, { prefix: AI_JOB_LOG_PREFIX });
    const days = records.sort((a, b) => b.key.localeCompare(a.key));
    for (const rec of days) {
        const entries = Array.isArray(rec.value) ? (rec.value as AiJobLogEntry[]) : [];
        const hit = entries.find(e => e && e.id === jobId);
        if (hit) return hit;
    }
    return null;
}

/** Every finished job in the retained logs, newest first. */
export async function listLogged(storage: Storage, ownerGhii: string): Promise<AiJobLogEntry[]> {
    const records = await storage.listMemory(ownerGhii, { prefix: AI_JOB_LOG_PREFIX });
    const out: AiJobLogEntry[] = [];
    for (const rec of records.sort((a, b) => b.key.localeCompare(a.key))) {
        const entries = Array.isArray(rec.value) ? (rec.value as AiJobLogEntry[]) : [];
        for (let i = entries.length - 1; i >= 0; i--) if (entries[i]) out.push(entries[i]);
    }
    return out;
}

/** Drop day logs older than the retention window. Returns how many records were removed. */
export async function pruneLogs(storage: Storage, ownerGhii: string, retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000).toISOString().slice(0, 10);
    const records = await storage.listMemory(ownerGhii, { prefix: AI_JOB_LOG_PREFIX });
    let removed = 0;
    for (const rec of records) {
        const day = rec.key.slice(AI_JOB_LOG_PREFIX.length);
        if (day < cutoff) {
            await storage.deleteMemory(ownerGhii, rec.key);
            removed++;
        }
    }
    return removed;
}

// ── the node-wide live index (restart reconciliation reads this) ───────────────

export interface ActiveJobRef { jobId: string; ownerGhii: string }

export async function readActiveIndex(storage: Storage, nodeId: string): Promise<ActiveJobRef[]> {
    const rec = await storage.getMemory(systemGhiiFor(nodeId), ACTIVE_INDEX_KEY);
    const arr = rec?.value as ActiveJobRef[] | undefined;
    return Array.isArray(arr) ? arr.filter(e => e && typeof e.jobId === 'string' && typeof e.ownerGhii === 'string') : [];
}

async function writeActiveIndex(storage: Storage, nodeId: string, entries: ActiveJobRef[]): Promise<void> {
    await upsert(storage, systemGhiiFor(nodeId), ACTIVE_INDEX_KEY, entries, ['ai', 'ai-job-index']);
}

export async function addToActiveIndex(storage: Storage, nodeId: string, ref: ActiveJobRef): Promise<void> {
    const entries = await readActiveIndex(storage, nodeId);
    if (entries.some(e => e.jobId === ref.jobId)) return;
    await writeActiveIndex(storage, nodeId, [...entries, ref]);
}

export async function removeFromActiveIndex(storage: Storage, nodeId: string, jobId: string): Promise<void> {
    const entries = await readActiveIndex(storage, nodeId);
    if (!entries.some(e => e.jobId === jobId)) return;
    await writeActiveIndex(storage, nodeId, entries.filter(e => e.jobId !== jobId));
}
