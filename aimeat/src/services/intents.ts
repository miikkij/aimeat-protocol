/**
 * @file src/services/intents.ts
 * @description The intent pool: one list of what a person means to do here, readable by their own
 *   AI. Stored as one owner-namespace memory record per intent under the `intent.` prefix.
 *
 *   One record per intent, not one blob holding all of them. SSE carries a domain but not a target
 *   id (services/event-bus.ts), so a single blob would repaint the whole pool on every change, and
 *   per-item tags and filters would stop being possible. `notebook.inbox.*` and `message-flag.*`
 *   already use prefix-and-query; this follows them.
 *
 *   Two things are deliberately NOT stored:
 *
 *   - **The prompt text.** `prompt_ref` holds a NAME, fetched from /v1/prompts/:name when it is
 *     needed. The node serves prompts precisely so a correction reaches the copies people already
 *     carry into their chats (services/welcome-mat-prompt.ts says so); snapshotting the text into
 *     the pool would freeze a fork, which is the thing that comment argues against.
 *   - **Whether a suggested step is finished.** `closes_when` names a condition and it is evaluated
 *     on READ, like the home's `initialized`. A satisfied suggestion stops being offered rather
 *     than being written done — so it comes back if the situation unwinds, which is right for a
 *     suggestion and wrong for something a person wrote.
 *
 *   `ttlHours: null` is load-bearing: the TTL cleanup job would otherwise empty the pool, and a
 *   to-do list that quietly empties itself is worse than none.
 * @structure INTENT_PREFIX · IntentRecord · listIntents · createIntent · updateIntent ·
 *   deleteIntent · evaluateCloses
 * @usage
 *   import { listIntents, createIntent } from '../services/intents.js';
 *   const open = await listIntents(storage, config, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 1).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { portfolioReadGaiis, PORTFOLIO_HTML_KEY } from '../routes/portfolio.js';
import { HELLO_MCP_KEY } from './hello-mcp.js';

export const INTENT_PREFIX = 'intent.';

/** The discovery vocabulary, reused rather than reinvented (services/discovery/types.ts). */
export const INTENT_KINDS = [
    'capability', 'workflow', 'knowledge', 'decision', 'research', 'material', 'company',
    'offering', 'document', 'organism', 'app', 'template', 'skill', 'memory',
] as const;
export type IntentKind = typeof INTENT_KINDS[number];

export type IntentStatus = 'open' | 'working' | 'done';

/** The conditions a system-suggested intent can close itself on. Evaluated on read. */
export const CLOSES_CHECKS = ['hello_mcp', 'welcome_mat', 'first_agent'] as const;
export type ClosesCheck = typeof CLOSES_CHECKS[number];

export interface IntentRecord {
    id: string;
    title: string;
    kind: IntentKind | null;
    prompt_ref: string | null;
    prompt_args: Record<string, unknown> | null;
    status: IntentStatus;
    object: { type: string; id: string } | null;
    origin: string | null;
    agent: string | null;
    taskId: string | null;
    closes_when: { check: ClosesCheck } | null;
    createdAt: string;
    updatedAt: string;
}

/** What a caller may set. Everything else is the server's to decide. */
export interface IntentInput {
    title: string;
    kind?: IntentKind | null;
    prompt_ref?: string | null;
    prompt_args?: Record<string, unknown> | null;
    origin?: string | null;
    object?: { type: string; id: string } | null;
    closes_when?: { check: ClosesCheck } | null;
}

const key = (id: string) => `${INTENT_PREFIX}${id}`;

/**
 * Tags carried on the record. `intent:open` / `intent:done` exist so an object that is itself
 * memory-backed can be marked at its own location without a second store — tags survive the
 * draft→publish promotion, which is why they are the marking that works.
 */
function tagsFor(status: IntentStatus): string[] {
    return ['intent', status === 'done' ? 'intent:done' : 'intent:open'];
}

function toRecord(value: unknown, id: string): IntentRecord | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (typeof v.title !== 'string') return null;
    return {
        id,
        title: v.title,
        kind: (typeof v.kind === 'string' ? v.kind as IntentKind : null),
        prompt_ref: typeof v.prompt_ref === 'string' ? v.prompt_ref : null,
        prompt_args: (v.prompt_args && typeof v.prompt_args === 'object')
            ? v.prompt_args as Record<string, unknown> : null,
        status: (v.status === 'working' || v.status === 'done') ? v.status : 'open',
        object: (v.object && typeof v.object === 'object'
            && typeof (v.object as { type?: unknown }).type === 'string')
            ? v.object as { type: string; id: string } : null,
        origin: typeof v.origin === 'string' ? v.origin : null,
        agent: typeof v.agent === 'string' ? v.agent : null,
        taskId: typeof v.taskId === 'string' ? v.taskId : null,
        closes_when: (v.closes_when && typeof v.closes_when === 'object'
            && CLOSES_CHECKS.includes((v.closes_when as { check?: string }).check as ClosesCheck))
            ? v.closes_when as { check: ClosesCheck } : null,
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString(),
        updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : new Date(0).toISOString(),
    };
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
            return (await storage.getAgentsByOwner(owner)).length > 0;
        default:
            return false;
    }
}

export interface ListedIntent extends IntentRecord {
    /** True when a suggestion's condition holds. Such an intent is not offered. */
    satisfied: boolean;
}

/**
 * Every intent in the owner's pool, newest first, with each suggestion's condition evaluated.
 *
 * Callers that render the pool drop `satisfied` ones; callers that audit it may want them, so the
 * filtering is the caller's decision and the flag is reported rather than applied here.
 */
export async function listIntents(
    storage: Storage, config: AimeatConfig, ownerGhii: string, owner: string,
): Promise<ListedIntent[]> {
    const rows = await storage.listMemory(ownerGhii, { prefix: INTENT_PREFIX });
    const out: ListedIntent[] = [];
    for (const row of rows) {
        const rec = toRecord(row.value, row.key.slice(INTENT_PREFIX.length));
        if (!rec) continue;
        const satisfied = rec.closes_when
            ? await evaluateCloses(storage, config, owner, rec.closes_when.check)
            : false;
        out.push({ ...rec, satisfied });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
}

export interface IntentStats {
    /** Everything a person put on the list. Suggestions are excluded: nobody chose those. */
    saved: number;
    /** How many of those reached done. */
    done: number;
    /** Of the done ones, how many an agent finished (they carry a taskId). */
    doneByAgent: number;
    /** …and how many the person ticked off themselves. */
    doneByHand: number;
    /** Where they came from, so a surface that seeds nothing can be told from one that works. */
    byOrigin: Record<string, number>;
}

/**
 * The three numbers the plan asks for, counted from the records rather than tallied into a
 * counter — a separate counter can drift from the thing it counts, and this cannot.
 *
 * The acceptance criterion (most of what is saved gets done, and at least a third of completions
 * come through an agent) is a judgement about real use over time. This reports; it does not
 * pronounce.
 */
export async function intentStats(
    storage: Storage, ownerGhii: string,
): Promise<IntentStats> {
    const rows = await storage.listMemory(ownerGhii, { prefix: INTENT_PREFIX });
    const stats: IntentStats = { saved: 0, done: 0, doneByAgent: 0, doneByHand: 0, byOrigin: {} };
    for (const row of rows) {
        const rec = toRecord(row.value, row.key.slice(INTENT_PREFIX.length));
        if (!rec || rec.closes_when) continue;   // a suggestion is not something a person saved
        stats.saved++;
        const origin = rec.origin ?? 'unknown';
        stats.byOrigin[origin] = (stats.byOrigin[origin] ?? 0) + 1;
        if (rec.status === 'done') {
            stats.done++;
            if (rec.taskId) stats.doneByAgent++; else stats.doneByHand++;
        }
    }
    return stats;
}

export async function getIntent(
    storage: Storage, ownerGhii: string, id: string,
): Promise<IntentRecord | null> {
    const row = await storage.getMemory(ownerGhii, key(id));
    return row ? toRecord(row.value, id) : null;
}

async function write(
    storage: Storage, ownerGhii: string, rec: IntentRecord,
): Promise<IntentRecord> {
    const existing = await storage.getMemory(ownerGhii, key(rec.id));
    await storage.setMemory({
        key: key(rec.id),
        ownerGaii: ownerGhii,
        value: rec as unknown as Record<string, unknown>,
        visibility: 'owner',
        tags: tagsFor(rec.status),
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? rec.createdAt,
        updatedAt: rec.updatedAt,
    });
    return rec;
}

export async function createIntent(
    storage: Storage, ownerGhii: string, input: IntentInput,
): Promise<IntentRecord> {
    const now = new Date().toISOString();
    const rec: IntentRecord = {
        id: randomUUID(),
        title: input.title,
        kind: input.kind ?? null,
        prompt_ref: input.prompt_ref ?? null,
        prompt_args: input.prompt_args ?? null,
        status: 'open',
        object: input.object ?? null,
        origin: input.origin ?? null,
        agent: null,
        taskId: null,
        closes_when: input.closes_when ?? null,
        createdAt: now,
        updatedAt: now,
    };
    return write(storage, ownerGhii, rec);
}

/** Fields a PATCH may move. `id`, `createdAt` and the owner are not among them. */
export type IntentPatch = Partial<Pick<IntentRecord,
    'title' | 'kind' | 'prompt_ref' | 'prompt_args' | 'status' | 'object' | 'agent' | 'taskId'>>;

export async function updateIntent(
    storage: Storage, ownerGhii: string, id: string, patch: IntentPatch,
): Promise<IntentRecord | null> {
    const current = await getIntent(storage, ownerGhii, id);
    if (!current) return null;
    const next: IntentRecord = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
    };
    return write(storage, ownerGhii, next);
}

/**
 * Close whatever intent a finished task came from.
 *
 * The pool's ONE indirect write by an agent, and it is the server that makes it: the agent never
 * writes into the owner's namespace, so "I finished" cannot be the thing that closes an item. A
 * completed task record is the evidence, and this reads it.
 *
 * Best-effort by design — the caller isolates it. A pool that cannot be updated must not turn a
 * real completion into an error the agent then retries.
 */
export async function closeIntentsForTask(
    storage: Storage, config: AimeatConfig, task: { agentGaii: string; resources?: { memoryKeys?: string[] } },
): Promise<number> {
    const keys = (task.resources?.memoryKeys ?? []).filter(k => k.startsWith(INTENT_PREFIX));
    if (keys.length === 0) return 0;
    // The task carries the agent's GAII; the intent lives under the OWNER's GHII.
    const owner = task.agentGaii.includes('#') ? task.agentGaii.split('#')[1].split('@')[0] : null;
    if (!owner) return 0;
    const ownerGhii = `${owner}@${config.nodeId}`;
    let closed = 0;
    for (const k of keys) {
        const id = k.slice(INTENT_PREFIX.length);
        const updated = await updateIntent(storage, ownerGhii, id, { status: 'done' });
        if (updated) closed++;
    }
    return closed;
}

export async function deleteIntent(
    storage: Storage, ownerGhii: string, id: string,
): Promise<boolean> {
    const current = await storage.getMemory(ownerGhii, key(id));
    if (!current) return false;
    await storage.deleteMemory(ownerGhii, key(id));
    return true;
}
