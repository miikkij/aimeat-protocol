/**
 * @file chat-threads.ts
 * @description Where a chat conversation lives: the person's own memory, under `chat.`.
 *
 *   Goose keeps its own session store, and it is a cache. The conversation is the person's, so the
 *   record here is the truth: if the agent process is replaced, restarted or swapped for a different
 *   engine entirely, the conversation survives.
 *
 *   The shape is chosen against a ceiling that is easy to walk into. A memory namespace holds 1000
 *   keys, and five conversations a day is 1825 keys a year, so one key per conversation forever is
 *   the wrong shape. Live conversations get a key each, because a person opens one at a time and
 *   expects to find it; older ones roll into one record per month. The same rule the node applies to
 *   anything that writes on a schedule: if keys per day times 365 exceeds 1000, the shape is wrong.
 * @structure
 *   - ChatThread / ChatTurn — the record
 *   - createThread() · appendTurn() · readThread() · listThreads() · archiveOverflow()
 * @usage
 *   const thread = await createThread(storage, config, gaii, 'Pong');
 *   await appendTurn(storage, config, gaii, thread.id, { role: 'user', text: 'build me pong' });
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** One thing said, by either side, with whatever the agent did while saying it. */
export interface ChatTurn {
    role: 'user' | 'agent';
    text: string;
    at: string;
    /** Compact record of the tool calls this turn made, for the work log. */
    tools?: Array<{ title: string; status: string }>;
    /** The things this turn produced, as the page draws them: a page, an app, an image, a record.
     *  Kept ON the turn so reopening the conversation still hands them over — a card that existed
     *  only in the live stream is a link the person had one chance to click. */
    cards?: Array<{ kind: string; title: string; url?: string; image?: string; ref?: string }>;
    /** Which model answered. Shown per turn, so "quality may vary" is checkable. */
    model?: string;
    /** Storage keys of what the person attached, so the conversation still shows them when it is
     *  reopened. Keys, never bytes: the record is read on every list. */
    attachments?: string[];
    /** The name this field had for a day. Read on old records, written on none. */
    images?: string[];
}

export interface ChatThread {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    /** goose's own session id, if one is currently attached. A cache: the turns are the truth. */
    gooseSessionId?: string;
    turns: ChatTurn[];
}

const LIVE_PREFIX = 'chat.thread.';
const ARCHIVE_PREFIX = 'chat.archive.';

/** How many conversations stay open before the oldest rolls into the month's archive. */
const MAX_LIVE_THREADS = 50;
/**
 * How much of one conversation is kept. A memory value tops out at 1024 kB, and a thread that grew
 * past it would fail to save — losing the newest turn, which is the one that mattered. Trimming the
 * oldest turns keeps the record writable and the recent context intact; goose does its own
 * compaction for what the model sees.
 */
const MAX_TURNS_PER_THREAD = 400;

const liveKey = (id: string) => `${LIVE_PREFIX}${id}`;
const archiveKey = (month: string) => `${ARCHIVE_PREFIX}${month}`;
const monthOf = (iso: string) => iso.slice(0, 7);

async function writeRecord(
    storage: Storage, gaii: string, key: string, value: unknown, tags: string[],
): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(gaii, key);
    await storage.setMemory({
        key, ownerGaii: gaii, value: value as Record<string, unknown>,
        visibility: 'private', tags, ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}

/** Start a conversation. The title is a placeholder until the first turn gives it a better one. */
export async function createThread(
    storage: Storage, config: AimeatConfig, gaii: string, title = 'New chat',
): Promise<ChatThread> {
    const now = new Date().toISOString();
    const thread: ChatThread = {
        id: randomBytes(9).toString('base64url'),
        title, createdAt: now, updatedAt: now, turns: [],
    };
    await writeRecord(storage, gaii, liveKey(thread.id), thread, ['chat', 'thread']);
    await archiveOverflow(storage, config, gaii);
    return thread;
}

export async function readThread(
    storage: Storage, gaii: string, id: string,
): Promise<ChatThread | null> {
    const rec = await storage.getMemory(gaii, liveKey(id));
    return (rec?.value as ChatThread | undefined) ?? null;
}

/** Every live conversation, newest first. */
export async function listThreads(storage: Storage, gaii: string): Promise<ChatThread[]> {
    const records = await storage.listMemory(gaii, { prefix: LIVE_PREFIX });
    return records
        .map((r) => r.value as ChatThread)
        .filter((t): t is ChatThread => !!t && typeof t.id === 'string')
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

/** Attach (or forget) the goose session a conversation is currently running on. */
export async function setGooseSession(
    storage: Storage, gaii: string, id: string, gooseSessionId: string | undefined,
): Promise<void> {
    const thread = await readThread(storage, gaii, id);
    if (!thread) return;
    thread.gooseSessionId = gooseSessionId;
    thread.updatedAt = new Date().toISOString();
    await writeRecord(storage, gaii, liveKey(id), thread, ['chat', 'thread']);
}

/**
 * Add one turn. Returns the thread as stored.
 *
 * The first thing a person says becomes the title, because a list of conversations all called "New
 * chat" is a list nobody can use.
 */
export async function appendTurn(
    storage: Storage, gaii: string, id: string, turn: ChatTurn,
): Promise<ChatThread | null> {
    const thread = await readThread(storage, gaii, id);
    if (!thread) return null;

    thread.turns.push(turn);
    if (thread.turns.length > MAX_TURNS_PER_THREAD) {
        const dropped = thread.turns.length - MAX_TURNS_PER_THREAD;
        thread.turns = thread.turns.slice(dropped);
        logger.info(`[chat] thread ${id}: dropped ${dropped} oldest turn(s) to stay under the value ceiling`);
    }
    if (thread.title === 'New chat' && turn.role === 'user' && turn.text.trim()) {
        thread.title = turn.text.trim().slice(0, 60);
    }
    thread.updatedAt = turn.at;

    await writeRecord(storage, gaii, liveKey(id), thread, ['chat', 'thread']);
    return thread;
}

/** Throw a conversation away entirely. */
export async function deleteThread(storage: Storage, gaii: string, id: string): Promise<void> {
    await storage.deleteMemory(gaii, liveKey(id));
}

/**
 * Roll the oldest conversations into the month they belong to, once there are more open than the
 * ceiling allows.
 *
 * Archived conversations stay readable — they are one record per month rather than one each — and
 * the key count stops growing with use, which is the whole point.
 */
export async function archiveOverflow(
    storage: Storage, config: AimeatConfig, gaii: string,
): Promise<number> {
    const max = Math.max(1, config.chatMaxLiveThreads);
    const threads = await listThreads(storage, gaii);
    if (threads.length <= max) return 0;

    const overflow = threads.slice(max);
    let archived = 0;
    for (const thread of overflow) {
        const month = monthOf(thread.updatedAt ?? thread.createdAt ?? new Date().toISOString());
        const key = archiveKey(month);
        const existing = (await storage.getMemory(gaii, key))?.value as { threads?: ChatThread[] } | undefined;
        const bundle = { threads: [...(existing?.threads ?? []), thread] };
        await writeRecord(storage, gaii, key, bundle, ['chat', 'archive']);
        await storage.deleteMemory(gaii, liveKey(thread.id));
        archived++;
    }
    if (archived > 0) logger.info(`[chat] archived ${archived} conversation(s) for ${gaii}`);
    return archived;
}

export { MAX_LIVE_THREADS, MAX_TURNS_PER_THREAD, LIVE_PREFIX, ARCHIVE_PREFIX };
