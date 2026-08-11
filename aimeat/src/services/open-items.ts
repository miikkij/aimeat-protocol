/**
 * @file src/services/open-items.ts
 * @description Open items: the one list of what a person is going to do here, readable and writable
 *   by their own AI. ONE owner-namespace memory record, `open-items.list`, holding an object with an
 *   array inside.
 *
 *   **It is a state you flip, not a row with a lifecycle.** A person switches something on where the
 *   thing is, and it is on the list. They flip it back in the same place and it is not. There is no
 *   TTL, no archival, no ageing marks: those were answers to a question that does not exist.
 *
 *   **One key, not one record per item.** The argument against this is real and worth keeping: SSE
 *   carries a domain but not a target id (services/event-bus.ts), so one key means every change
 *   repaints the whole list. With ten rows that costs nothing, and in exchange the count behind the
 *   header button is a single key read rather than a prefix scan, and a busy account does not grow a
 *   thousand records. Precedent: `app-catalog.favorites`.
 *
 *   **Three writers, therefore optimistic locking.** The person, their AI and the server all write
 *   this key. Every write here is read-modify-write carrying the version it read; a conflict means
 *   somebody got there first, so it re-reads and retries rather than overwriting. Silently losing a
 *   toggle somebody just made is the one failure this file exists to prevent.
 *
 *   Two things are deliberately NOT stored:
 *
 *   - **The prompt text.** `prompt_ref` holds a NAME, fetched from /v1/prompts/:name when needed.
 *     The node serves prompts precisely so a correction reaches the copies people already carry into
 *     their chats; snapshotting the text here would freeze a fork.
 *   - **Whether a suggested step is finished.** `closes_when` names a condition evaluated on READ,
 *     like the home's `initialized`. A satisfied suggestion stops being offered rather than being
 *     written done, so it comes back if the situation unwinds — right for a suggestion, wrong for
 *     something a person switched on themselves.
 * @structure OPEN_ITEMS_KEY · OpenItem · readList · listItems · addItem · patchItem · closeItem ·
 *   itemStats · evaluateCloses · closeItemsForTask
 * @usage
 *   import { listItems, addItem } from '../services/open-items.js';
 *   const open = await listItems(storage, config, ownerGhii, owner);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Replaces services/intents.ts. One key (P22) instead of one record per
 *     item, a flipped state (P19) instead of open→working→done, and `by` so the surface can show
 *     that the AI flipped something rather than the person.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { portfolioReadGaiis, PORTFOLIO_HTML_KEY } from '../routes/portfolio.js';
import { HELLO_MCP_KEY } from './hello-mcp.js';
import { loadOwnerAgents } from './db/owner-identity.js';

/** The one key. Named for what a person calls it, because their AI reads this name aloud. */
export const OPEN_ITEMS_KEY = 'open-items.list';

/** Envelope shape version. Not the memory record's version — that is the optimistic lock. */
export const ENVELOPE_VERSION = 1;

/** How many items one list may hold. A list nobody can read is not a feature. */
export const MAX_ITEMS = 200;

/** Retries on a write conflict before giving up. Three writers, so a collision is possible. */
const WRITE_ATTEMPTS = 4;

/** The discovery vocabulary, reused rather than reinvented (services/discovery/types.ts). */
export const ITEM_KINDS = [
    'capability', 'workflow', 'knowledge', 'decision', 'research', 'material', 'company',
    'offering', 'document', 'organism', 'app', 'template', 'skill', 'memory',
] as const;
export type ItemKind = typeof ITEM_KINDS[number];

/** On the list, and on the list with somebody working it. Off the list is not a status. */
export type ItemStatus = 'open' | 'working';

/** Who flipped it. The surface shows this: a person must see when their AI acted for them. */
export type FlippedBy = 'person' | 'ai';

/** The conditions a system-suggested item can close itself on. Evaluated on read. */
export const CLOSES_CHECKS = ['hello_mcp', 'welcome_mat', 'first_agent'] as const;
export type ClosesCheck = typeof CLOSES_CHECKS[number];

export interface OpenItem {
    id: string;
    title: string;
    kind: ItemKind | null;
    prompt_ref: string | null;
    prompt_args: Record<string, unknown> | null;
    status: ItemStatus;
    object: { type: string; id: string } | null;
    origin: string | null;
    by: FlippedBy;
    agent: string | null;
    taskId: string | null;
    closes_when: { check: ClosesCheck } | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * An item that was switched off, kept so the question "does anything on this list get done" has an
 * answer. Not a lifecycle: nothing ages it, nothing shows it, nothing acts on it.
 */
export interface ClosedItem {
    id: string;
    title: string;
    origin: string | null;
    by: FlippedBy;
    /** Who switched it off, which is not always who switched it on. */
    closedBy: FlippedBy;
    /** Present when an agent's finished task closed it. */
    taskId: string | null;
    createdAt: string;
    closedAt: string;
}

export interface OpenItemsList {
    version: number;
    items: OpenItem[];
    closed: ClosedItem[];
}

/** What a caller may set. Everything else is the server's to decide. */
export interface ItemInput {
    title: string;
    kind?: ItemKind | null;
    prompt_ref?: string | null;
    prompt_args?: Record<string, unknown> | null;
    origin?: string | null;
    object?: { type: string; id: string } | null;
    closes_when?: { check: ClosesCheck } | null;
    by?: FlippedBy;
}

const EMPTY: OpenItemsList = { version: ENVELOPE_VERSION, items: [], closed: [] };

function str(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}

function toItem(value: unknown): OpenItem | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.title !== 'string' || typeof v.id !== 'string') return null;
    return {
        id: v.id,
        title: v.title,
        kind: typeof v.kind === 'string' ? v.kind as ItemKind : null,
        prompt_ref: str(v.prompt_ref),
        prompt_args: (v.prompt_args && typeof v.prompt_args === 'object')
            ? v.prompt_args as Record<string, unknown> : null,
        status: v.status === 'working' ? 'working' : 'open',
        object: (v.object && typeof v.object === 'object'
            && typeof (v.object as { type?: unknown }).type === 'string')
            ? v.object as { type: string; id: string } : null,
        origin: str(v.origin),
        by: v.by === 'ai' ? 'ai' : 'person',
        agent: str(v.agent),
        taskId: str(v.taskId),
        closes_when: (v.closes_when && typeof v.closes_when === 'object'
            && CLOSES_CHECKS.includes((v.closes_when as { check?: string }).check as ClosesCheck))
            ? v.closes_when as { check: ClosesCheck } : null,
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString(),
        updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : new Date(0).toISOString(),
    };
}

function toClosed(value: unknown): ClosedItem | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
    return {
        id: v.id,
        title: v.title,
        origin: str(v.origin),
        by: v.by === 'ai' ? 'ai' : 'person',
        closedBy: v.closedBy === 'ai' ? 'ai' : 'person',
        taskId: str(v.taskId),
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString(),
        closedAt: typeof v.closedAt === 'string' ? v.closedAt : new Date(0).toISOString(),
    };
}

/** A stored value is whatever someone wrote there. Parse defensively, never trust the shape. */
function toList(value: unknown): OpenItemsList {
    if (!value || typeof value !== 'object') return { ...EMPTY };
    const v = value as Record<string, unknown>;
    const items = Array.isArray(v.items)
        ? v.items.map(toItem).filter((x): x is OpenItem => x !== null) : [];
    const closed = Array.isArray(v.closed)
        ? v.closed.map(toClosed).filter((x): x is ClosedItem => x !== null) : [];
    return { version: typeof v.version === 'number' ? v.version : ENVELOPE_VERSION, items, closed };
}

/** The list plus the memory version it was read at, which the next write must carry. */
export interface ReadList {
    list: OpenItemsList;
    /** 0 when the key does not exist yet — the value `expected_version` wants in that case. */
    memoryVersion: number;
}

export async function readList(storage: Storage, ownerGhii: string): Promise<ReadList> {
    const row = await storage.getMemory(ownerGhii, OPEN_ITEMS_KEY);
    return { list: row ? toList(row.value) : { ...EMPTY }, memoryVersion: row?.version ?? 0 };
}

/** Thrown when the list changed under a write and the retries ran out. */
export class OpenItemsConflict extends Error {
    constructor() { super('open-items.list changed while writing; re-read and retry'); }
}

/**
 * Read, let the caller change the list, write it back with the version it read.
 *
 * The retry is the whole point: three writers means a collision is normal rather than exceptional,
 * and a caller should not have to think about it. `mutate` may be called more than once, so it must
 * be a pure function of the list it is given.
 */
export async function mutateList<T>(
    storage: Storage, ownerGhii: string,
    mutate: (list: OpenItemsList) => { list: OpenItemsList; result: T },
): Promise<T> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
        const row = await storage.getMemory(ownerGhii, OPEN_ITEMS_KEY);
        const memoryVersion = row?.version ?? 0;
        const { list: next, result } = mutate(row ? toList(row.value) : { ...EMPTY });
        const now = new Date().toISOString();
        const record = {
            key: OPEN_ITEMS_KEY,
            ownerGaii: ownerGhii,
            value: next as unknown as Record<string, unknown>,
            visibility: 'owner' as const,
            tags: ['open-items'],
            ttlHours: null,                       // the TTL job would otherwise empty the list
            version: memoryVersion + 1,
            createdAt: row?.createdAt ?? now,
            updatedAt: now,
        };

        // Compare-and-swap rather than read-then-write. Checking the version with a second read and
        // then writing leaves a gap another writer fits through; these two primitives close it in
        // the storage layer. They are optional on the interface, so fall back to a plain upsert on a
        // backend that lacks them, the same way the legacy memory adapter does.
        if (memoryVersion === 0) {
            if (!storage.createMemoryIfAbsent) { await storage.setMemory(record); return result; }
            if (await storage.createMemoryIfAbsent(record)) return result;
        } else {
            if (!storage.setMemoryIfVersion) { await storage.setMemory(record); return result; }
            if (await storage.setMemoryIfVersion(record, memoryVersion)) return result;
        }
        // Lost the swap: somebody wrote between the read and the write. Read again and re-apply.
    }
    throw new OpenItemsConflict();
}

/**
 * Is this suggestion's condition already true?
 *
 * Evaluated here, on read, never stored. Same principle as the home's `initialized`: a derived
 * answer cannot go stale, and a suggestion whose situation unwinds should come back.
 */
export async function evaluateCloses(
    storage: Storage, config: AimeatConfig, owner: string, check: ClosesCheck,
): Promise<boolean> {
    switch (check) {
        case 'hello_mcp':
            // Written by the AGENT under its own GAII, so this must read owner-scope.
            return !!(await getOwnerScopeMemory(storage, config.nodeId, owner, HELLO_MCP_KEY));
        case 'welcome_mat': {
            // The FILE, not the marker: a deleted portfolio must un-satisfy this.
            for (const gaii of await portfolioReadGaiis(storage, owner, config.nodeId)) {
                if (await storage.getStorageFile(gaii, PORTFOLIO_HTML_KEY)) return true;
            }
            return false;
        }
        case 'first_agent':
            return (await loadOwnerAgents(storage, owner)).length > 0;
        default:
            return false;
    }
}

export interface ListedItem extends OpenItem {
    /** True when a suggestion's condition holds. Such an item is not offered. */
    satisfied: boolean;
}

/**
 * Everything on the list, newest first, with each suggestion's condition evaluated.
 *
 * Callers that render drop `satisfied` ones; callers that audit may want them, so the filtering is
 * the caller's decision and the flag is reported rather than applied here.
 */
export async function listItems(
    storage: Storage, config: AimeatConfig, ownerGhii: string, owner: string,
): Promise<ListedItem[]> {
    const { list } = await readList(storage, ownerGhii);
    const out: ListedItem[] = [];
    for (const item of list.items) {
        const satisfied = item.closes_when
            ? await evaluateCloses(storage, config, owner, item.closes_when.check)
            : false;
        out.push({ ...item, satisfied });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
}

/** How many are switched on right now. This is the number behind the header button. */
export async function openCount(
    storage: Storage, config: AimeatConfig, ownerGhii: string, owner: string,
): Promise<number> {
    return (await listItems(storage, config, ownerGhii, owner)).filter(i => !i.satisfied).length;
}

export interface ItemStats {
    /** Switched on right now, suggestions excluded: nobody chose those. */
    open: number;
    /** Everything a person or their AI ever switched on. */
    everOpened: number;
    /** How many of those were switched off again. */
    closed: number;
    /** Of those, how many were switched off by an AI rather than by the person. */
    closedByAgent: number;
    /** Where they came from, so a surface that seeds nothing can be told from one that works. */
    byOrigin: Record<string, number>;
    /** How many the AI switched on rather than the person. */
    openedByAi: number;
}

/**
 * Counted from the list rather than tallied into a counter — a counter drifts from the thing it
 * counts, and this cannot. Reports; does not pronounce on the acceptance criterion.
 */
export async function itemStats(storage: Storage, ownerGhii: string): Promise<ItemStats> {
    const { list } = await readList(storage, ownerGhii);
    const stats: ItemStats = {
        open: 0, everOpened: 0, closed: 0, closedByAgent: 0, byOrigin: {}, openedByAi: 0,
    };
    const count = (origin: string | null) => {
        const o = origin ?? 'unknown';
        stats.byOrigin[o] = (stats.byOrigin[o] ?? 0) + 1;
    };
    for (const item of list.items) {
        if (item.closes_when) continue;           // a suggestion is not something anyone chose
        stats.open++;
        stats.everOpened++;
        if (item.by === 'ai') stats.openedByAi++;
        count(item.origin);
    }
    for (const item of list.closed) {
        stats.everOpened++;
        stats.closed++;
        if (item.closedBy === 'ai') stats.closedByAgent++;
        if (item.by === 'ai') stats.openedByAi++;
        count(item.origin);
    }
    return stats;
}

export async function getItem(
    storage: Storage, ownerGhii: string, id: string,
): Promise<OpenItem | null> {
    const { list } = await readList(storage, ownerGhii);
    return list.items.find(i => i.id === id) ?? null;
}

/** Switch something on. Returns the item, or null when the list is full. */
export async function addItem(
    storage: Storage, ownerGhii: string, input: ItemInput,
): Promise<OpenItem | null> {
    const now = new Date().toISOString();
    const item: OpenItem = {
        id: randomUUID(),
        title: input.title,
        kind: input.kind ?? null,
        prompt_ref: input.prompt_ref ?? null,
        prompt_args: input.prompt_args ?? null,
        status: 'open',
        object: input.object ?? null,
        origin: input.origin ?? null,
        by: input.by ?? 'person',
        agent: null,
        taskId: null,
        closes_when: input.closes_when ?? null,
        createdAt: now,
        updatedAt: now,
    };
    return mutateList(storage, ownerGhii, (list) => {
        if (list.items.length >= MAX_ITEMS) return { list, result: null };
        return { list: { ...list, items: [...list.items, item] }, result: item };
    });
}

/** Fields a patch may move. `id`, `createdAt` and the owner are not among them. */
export type ItemPatch = Partial<Pick<OpenItem,
    'title' | 'kind' | 'prompt_ref' | 'prompt_args' | 'status' | 'object' | 'agent' | 'taskId'>>;

export async function patchItem(
    storage: Storage, ownerGhii: string, id: string, patch: ItemPatch,
): Promise<OpenItem | null> {
    return mutateList(storage, ownerGhii, (list) => {
        const idx = list.items.findIndex(i => i.id === id);
        if (idx === -1) return { list, result: null };
        const next: OpenItem = {
            ...list.items[idx], ...patch,
            id: list.items[idx].id,
            createdAt: list.items[idx].createdAt,
            updatedAt: new Date().toISOString(),
        };
        const items = [...list.items];
        items[idx] = next;
        return { list: { ...list, items }, result: next };
    });
}

/**
 * Switch something off. It leaves the list; a short record of it stays in `closed` so the question
 * "does anything here actually get done" has an answer. Nothing ages it and nothing shows it.
 */
export async function closeItem(
    storage: Storage, ownerGhii: string, id: string, closedBy: FlippedBy = 'person',
): Promise<boolean> {
    return mutateList(storage, ownerGhii, (list) => {
        const item = list.items.find(i => i.id === id);
        if (!item) return { list, result: false };
        const closed: ClosedItem = {
            id: item.id,
            title: item.title,
            origin: item.origin,
            by: item.by,
            closedBy,
            taskId: item.taskId,
            createdAt: item.createdAt,
            closedAt: new Date().toISOString(),
        };
        return {
            list: {
                ...list,
                items: list.items.filter(i => i.id !== id),
                closed: [...list.closed, closed],
            },
            result: true,
        };
    });
}

/**
 * A memory-key reference to one item, for a task's `resources.memoryKeys`.
 *
 * The key is one and the items are many, so the id rides in a fragment. An agent that reads the key
 * gets the whole list and can find its own item by the id it was handed.
 */
export const itemRef = (id: string) => `${OPEN_ITEMS_KEY}#${id}`;

/**
 * Switch off whatever item a finished task came from.
 *
 * The server makes this write, not the agent, because a completed task record is the evidence and
 * "I finished" is not. Best-effort by design: a list that cannot be updated must not turn a real
 * completion into an error the agent then retries.
 */
export async function closeItemsForTask(
    storage: Storage, config: AimeatConfig,
    task: { agentGaii: string; resources?: { memoryKeys?: string[] } },
): Promise<number> {
    const ids = (task.resources?.memoryKeys ?? [])
        .filter(k => k.startsWith(`${OPEN_ITEMS_KEY}#`))
        .map(k => k.slice(OPEN_ITEMS_KEY.length + 1))
        .filter(Boolean);
    if (ids.length === 0) return 0;
    // The task carries the agent's GAII; the list lives under the OWNER's GHII.
    const owner = task.agentGaii.includes('#') ? task.agentGaii.split('#')[1].split('@')[0] : null;
    if (!owner) return 0;
    const ownerGhii = `${owner}@${config.nodeId}`;
    let closed = 0;
    for (const id of ids) {
        if (await closeItem(storage, ownerGhii, id, 'ai')) closed++;
    }
    return closed;
}
