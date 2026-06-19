/**
 * @file quota.ts
 * @description Quota enforcement and overage charging — RFC §8.2, §8.4, §5.7.4, §15
 *
 * Memory:        default 10 MB total per agent, 10 morsels/MB/month overage
 * Storage:       default 100 MB total per agent, 100 morsels/GB/month overage
 * Micro-memory:  default 500 KB total per agent (hard limit)
 *
 * @version-history
 *   v1.1.0 — 2026-06-20 — Security (H-5): add enforceExtensionMemoryLimits() so
 *     extension ctx.memory.set respects the per-value-size + per-key-count limits.
 */

import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, MicroMemoryRecord } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';

// ── Size calculators ──

/** Calculate total memory size for an agent (all keys, JSON-serialised values). */
export async function getMemoryTotalBytes(storage: Storage, gaii: string): Promise<number> {
    const records = await storage.listMemory(gaii);
    let total = 0;
    for (const r of records) {
        total += Buffer.byteLength(JSON.stringify(r.value), 'utf8');
    }
    return total;
}

/** Calculate total storage file size for an agent (sum of file.size). */
export async function getStorageTotalBytes(storage: Storage, gaii: string): Promise<number> {
    const files = await storage.listStorageFiles(gaii);
    let total = 0;
    for (const f of files) {
        total += f.size;
    }
    return total;
}

/** Calculate total micro-memory size for an agent (all sets, all entries). */
export async function getMicroMemoryTotalBytes(storage: Storage, gaii: string): Promise<number> {
    const sets = await storage.listMicroMemorySets(gaii);
    let total = 0;
    for (const s of sets) {
        for (const [k, v] of Object.entries(s.entries)) {
            total += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
        }
    }
    return total;
}

/**
 * Enforce the per-value-size and per-key-count hard limits for an extension's
 * `ctx.memory.set`. The REST `/v1/memory` handler enforces these, but extensions
 * write via `storage.setMemory()` directly and would otherwise bypass them — a
 * loop of large writes could exhaust disk/DB. Throws on violation (surfaces as an
 * extension error). `ownerGaii` is the extension namespace (`ext:{name}`).
 */
export async function enforceExtensionMemoryLimits(
    config: AimeatConfig,
    storage: Storage,
    ownerGaii: string,
    key: string,
    value: unknown,
): Promise<void> {
    const maxValueSize = config.memoryMaxValueSizeKb * 1024;
    const valueSize = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (valueSize > maxValueSize) {
        throw new Error(`QUOTA_EXCEEDED: value size ${valueSize} bytes exceeds limit of ${maxValueSize} bytes`);
    }
    // Only count keys when adding a new one (updates to an existing key don't grow the count).
    const existing = await storage.getMemory(ownerGaii, key);
    if (!existing) {
        const allKeys = await storage.listMemory(ownerGaii);
        if (allKeys.length >= config.memoryMaxKeysPerAgent) {
            throw new Error(`QUOTA_EXCEEDED: memory key limit reached (${config.memoryMaxKeysPerAgent}). Delete unused keys first.`);
        }
    }
}

// ── Quota check results ──

export interface QuotaCheckResult {
    allowed: boolean;
    currentBytes: number;
    quotaBytes: number;
    overageBytes: number;
    /** Morsels that will be charged for overage (0 if within quota). */
    overageMorsels: number;
    /** If not allowed and no overage charging possible, this explains why. */
    reason?: string;
}

// ── Quota checkers ──

/**
 * Check if a memory write of `additionalBytes` would exceed the quota.
 * If the agent has enough morsels, overage is allowed and charged.
 * `replacingBytes` is subtracted first (for updates to existing keys).
 */
export async function checkMemoryQuota(
    config: AimeatConfig,
    storage: Storage,
    gaii: string,
    additionalBytes: number,
    replacingBytes: number = 0,
): Promise<QuotaCheckResult> {
    const currentBytes = await getMemoryTotalBytes(storage, gaii);
    const projectedBytes = currentBytes - replacingBytes + additionalBytes;
    const quotaBytes = config.memoryQuotaMb * 1024 * 1024;

    if (projectedBytes <= quotaBytes) {
        return { allowed: true, currentBytes, quotaBytes, overageBytes: 0, overageMorsels: 0 };
    }

    // Over quota — check if owner can pay overage morsels from GHII balance
    const overageBytes = projectedBytes - quotaBytes;
    const overageMb = Math.ceil(overageBytes / (1024 * 1024));
    const overageMorsels = overageMb * config.memoryOverageMorselsPerMbMonth;

    if (overageMorsels === 0) {
        return { allowed: true, currentBytes, quotaBytes, overageBytes, overageMorsels: 0 };
    }

    const { owner } = parseGaiiLoose(gaii);
    const ghiiRecord = owner ? await storage.getGHIIByOwner(owner) : null;
    const balance = ghiiRecord?.morselBalance ?? 0;
    if (!ghiiRecord || balance < overageMorsels) {
        return {
            allowed: false, currentBytes, quotaBytes, overageBytes, overageMorsels,
            reason: `Memory quota exceeded (${(projectedBytes / (1024 * 1024)).toFixed(2)}MB / ${config.memoryQuotaMb}MB). ` +
                `Overage costs ${overageMorsels} morsels but balance is ${balance}.`,
        };
    }

    return { allowed: true, currentBytes, quotaBytes, overageBytes, overageMorsels };
}

/**
 * Check storage file quota for an agent.
 */
export async function checkStorageQuota(
    config: AimeatConfig,
    storage: Storage,
    gaii: string,
    additionalBytes: number,
): Promise<QuotaCheckResult> {
    const currentBytes = await getStorageTotalBytes(storage, gaii);
    const projectedBytes = currentBytes + additionalBytes;
    const quotaBytes = config.storageQuotaMb * 1024 * 1024;

    if (projectedBytes <= quotaBytes) {
        return { allowed: true, currentBytes, quotaBytes, overageBytes: 0, overageMorsels: 0 };
    }

    const overageBytes = projectedBytes - quotaBytes;
    const overageGb = Math.ceil(overageBytes / (1024 * 1024 * 1024)) || 1; // minimum 1 GB billing unit
    const overageMorsels = overageGb * config.storageOverageMorselsPerGbMonth;

    const { owner } = parseGaiiLoose(gaii);
    const ghiiRecord = owner ? await storage.getGHIIByOwner(owner) : null;
    const balance = ghiiRecord?.morselBalance ?? 0;
    if (!ghiiRecord || balance < overageMorsels) {
        return {
            allowed: false, currentBytes, quotaBytes, overageBytes, overageMorsels,
            reason: `Storage quota exceeded (${(projectedBytes / (1024 * 1024)).toFixed(2)}MB / ${config.storageQuotaMb}MB). ` +
                `Overage costs ${overageMorsels} morsels but balance is ${balance}.`,
        };
    }

    return { allowed: true, currentBytes, quotaBytes, overageBytes, overageMorsels };
}

/**
 * Check micro-memory total quota (hard limit, no overage).
 */
export async function checkMicroMemoryQuota(
    config: AimeatConfig,
    storage: Storage,
    gaii: string,
    additionalBytes: number,
): Promise<QuotaCheckResult> {
    const currentBytes = await getMicroMemoryTotalBytes(storage, gaii);
    const projectedBytes = currentBytes + additionalBytes;
    const quotaBytes = config.microMemoryQuotaKb * 1024;

    if (projectedBytes <= quotaBytes) {
        return { allowed: true, currentBytes, quotaBytes, overageBytes: 0, overageMorsels: 0 };
    }

    return {
        allowed: false, currentBytes, quotaBytes,
        overageBytes: projectedBytes - quotaBytes, overageMorsels: 0,
        reason: `Micro-memory quota exceeded (${(projectedBytes / 1024).toFixed(1)}KB / ${config.microMemoryQuotaKb}KB).`,
    };
}

/**
 * Charge overage morsels to an agent and log the transaction.
 * Call this after a successful quota check that reported overageMorsels > 0.
 */
export async function chargeOverage(
    storage: Storage,
    gaii: string,
    morsels: number,
    type: 'memory_overage' | 'storage_overage',
): Promise<void> {
    if (morsels <= 0) return;

    // Atomic debit — may go negative for overage charges (intentional)
    await storage.debitBalance(gaii, morsels);
    await storage.addTransaction({
        id: `tx-${randomUUID()}`,
        gaii,
        type,
        amount: -morsels,
        timestamp: new Date().toISOString(),
    });
}
