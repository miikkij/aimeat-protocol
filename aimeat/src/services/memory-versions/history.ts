/**
 * @file src/services/memory-versions/history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The earlier versions of one memory record, for GET /v1/memory/history/:key and the
 *   aimeat_memory_history MCP tool: the list of kept versions with what each write changed, or one
 *   version's whole value. Restoring is a plain write of that value with expected_version, so the
 *   version it replaces is kept in turn and a restore can be undone the same way.
 *
 *   WHO READS IT. Only the record's own principal, or a session of the same person that reads as
 *   the owner: the person in person, or an agent holding memory:read-as-owner. An earlier version
 *   may hold what the current one no longer shows, so a reader the current visibility admits (a
 *   group, an organism, the public) does not read the history. An app grant and an ecosystem app do
 *   not either. A caller that may not even see the current record is answered as for a missing key.
 *
 *   Every value passes the caller's classification reader and the credential mask (presentMemories),
 *   and an organism record passes the organism read rule, as the current record does on a plain read.
 * @structure HISTORY_LIST_MAX · readMemoryHistory()
 * @usage
 *   const out = await readMemoryHistory({ storage, config }, caller, reader, { key, ownerScope: true });
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import type { ContentReader } from '../classification/reader.js';
import { presentMemories } from '../classification/present-memory.js';
import { ownerScopeView, readsAsOwner, READ_AS_OWNER_SCOPE } from '../owner-scope-read.js';
import { organismReadableRecords } from '../organism-namespace-access.js';
import { diffJson, type JsonChange } from './diff.js';
import { keepsHistory, HISTORY_KEEP } from '../context/history-keys.js';

/** The most versions one listing returns. */
export const HISTORY_LIST_MAX = HISTORY_KEEP;

export interface MemoryHistoryInput {
    key: string;
    /** Look under the person as well as under the caller (as aimeat_memory_read's owner_scope). */
    ownerScope: boolean;
    /** One version's whole value instead of the list. */
    version?: number;
    /** How many versions the list shows, newest first (default 20). */
    limit?: number;
}

export interface MemoryHistoryEntry {
    version: number;
    recorded_at: string;
    current: boolean;
    /** What this version changed compared with the one before it; null for the oldest kept. */
    changes: JsonChange[] | null;
    changes_truncated?: boolean;
}

export type MemoryHistoryResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; status: number; code: string; message: string };

const notFound = (key: string): MemoryHistoryResult =>
    ({ ok: false, status: 404, code: 'NOT_FOUND', message: `Memory key not found: ${key}` });

/** The kept versions of one record, or one version's value. */
export async function readMemoryHistory(
    deps: { storage: Storage; config: AimeatConfig },
    caller: CallerContext,
    reader: ContentReader,
    input: MemoryHistoryInput,
): Promise<MemoryHistoryResult> {
    const { storage } = deps;
    const { key } = input;
    if (caller.kind === 'ecosystem' || caller.kind === 'app' || caller.visitor || caller.kind === 'anonymous') {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'The earlier versions of a record are read by its owner, or by an agent that reads as the owner.' };
    }

    let record: MemoryRecord | null = await storage.getMemory(caller.principal, key);
    const underPerson = !record && (input.ownerScope || caller.inPerson) && caller.ownerGhii !== caller.principal;
    if (underPerson) record = await storage.getMemory(caller.ownerGhii, key);
    if (!record) return notFound(key);

    const own = record.ownerGaii === caller.principal;
    const asOwner = record.ownerGaii === caller.ownerGhii && (caller.inPerson || caller.has(READ_AS_OWNER_SCOPE));
    if (!own && !asOwner) {
        // Seen at all? Then say what is missing; otherwise the key answers as absent.
        const visible = ownerScopeView([record], caller.principal, readsAsOwner(caller)).length > 0;
        return visible
            ? { ok: false, status: 403, code: 'SCOPE_DENIED', message: `Reading the earlier versions of the person's record needs the ${READ_AS_OWNER_SCOPE} permission.` }
            : notFound(key);
    }
    if (!(await organismReadableRecords(deps, caller, [record])).length) return notFound(key);

    const archived = await storage.listMemoryHistory(record.ownerGaii, key, { limit: HISTORY_KEEP + 1 });
    const rows = [
        { key, ownerGaii: record.ownerGaii, value: record.value, version: record.version, recordedAt: record.updatedAt, current: true },
        ...archived.map(v => ({ key, ownerGaii: v.ownerGaii, value: v.value, version: v.version, recordedAt: v.recordedAt, current: false })),
    ];
    const shown = await presentMemories(reader, rows);
    if (!shown.length || !shown[0]!.current) return notFound(key);

    if (input.version !== undefined) {
        const one = shown.find(r => r.version === input.version);
        if (!one) {
            return { ok: false, status: 404, code: 'NOT_FOUND', message: `Version ${input.version} of "${key}" is not kept. The kept versions are ${shown.map(r => r.version).join(', ')}.` };
        }
        return { ok: true, data: { key, version: one.version, current_version: record.version, recorded_at: one.recordedAt, value: one.value } };
    }

    const limit = Math.min(Math.max(1, input.limit ?? 20), HISTORY_LIST_MAX);
    const versions: MemoryHistoryEntry[] = shown.slice(0, limit).map((r, i) => {
        const prev = shown[i + 1];
        if (!prev) return { version: r.version, recorded_at: r.recordedAt, current: r.current, changes: null };
        const d = diffJson(prev.value, r.value);
        return { version: r.version, recorded_at: r.recordedAt, current: r.current, changes: d.changes, ...(d.truncated ? { changes_truncated: true } : {}) };
    });
    return {
        ok: true,
        data: {
            key,
            current_version: record.version,
            keeps_history: keepsHistory(key) || record.trackable === true,
            kept: shown.length - 1,
            versions,
        },
    };
}
