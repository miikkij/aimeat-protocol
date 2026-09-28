/**
 * @file src/services/chat-agent-pool.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat agent processes that are running, one per key: one per person on the node
 *   route, one for everybody on the shared key (services/goose-env.ts).
 *
 *   WHY ONE PER PERSON. Goose reads its provider, model and key from the process environment, so a
 *   process speaks to one provider with one key. On the node route that key is one person's own chat
 *   token, which /v1/llm meters and budgets for that person. A process shared by two people would
 *   spend the first person's budget on the second person's turns, so a process holds one person's
 *   token and runs only that person's turns.
 *
 *   WHAT KEEPS THE COUNT DOWN. A process is started on the person's first turn and closed after it
 *   has been idle for `idleMs`. At most `maxLive` processes run: a new one first closes the process
 *   that has been idle longest, and when every live process has a turn in flight the new turn is
 *   refused with a reason rather than started over the ceiling.
 *
 *   A process is replaced, not reused, when it has exited, or when the credential it carries
 *   expires within `renewBeforeMs` (a turn can run 15 minutes, and a key that expires in the middle
 *   of one fails that turn). A replaced process with a turn in flight keeps running until the turn
 *   ends, and is then closed.
 *
 *   Every process gets a generation number that no other process in this node's lifetime has had.
 *   A goose session id is stamped with it (services/chat-session.ts), so a session a closed process
 *   issued is never sent to its replacement.
 * @structure
 *   - PoolClient — what the pool needs of a process: isClosed, close()
 *   - AgentPool — acquire(key, start, opts), generationOf(key), retire(key), retireAllExcept(key),
 *     sweep(), closeAll(), size
 *   - AgentLease — the client, its generation, release()
 * @usage
 *   const lease = await pool.acquire(owner, () => startAgent(owner), { evictIdle: true });
 *   try { … lease.client … } finally { lease.release(); }
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial. System 2 plan, V5.
 */
import { logger } from '../utils/logger.js';

/** What the pool needs of a process. GooseAcpClient has both. */
export interface PoolClient {
    readonly isClosed: boolean;
    close(): void;
}

/** A started process, with the expiry of the credential it carries and what to do when it closes. */
export interface PoolStart<C extends PoolClient> {
    client: C;
    /** Epoch milliseconds when the credential inside the process stops working. */
    expiresAt?: number;
    /** Runs once, when the pool closes or drops the process (revoke its credential, for example). */
    onClose?: () => void;
}

export interface AgentPoolOptions {
    /** How long a process with no turn in flight stays up (only for entries acquired with evictIdle). */
    idleMs: number;
    /** The most processes that run at once. */
    maxLive: number;
    /** A process whose credential expires within this is replaced before a turn is run on it. */
    renewBeforeMs: number;
    /** The clock, for tests. */
    now?: () => number;
}

/** One turn's hold on a process. release() must be called exactly once, in a finally block. */
export interface AgentLease<C extends PoolClient> {
    client: C;
    generation: number;
    release(): void;
}

interface Entry<C extends PoolClient> {
    key: string;
    client: C;
    generation: number;
    lastUsed: number;
    active: number;
    evictIdle: boolean;
    expiresAt?: number;
    onClose?: () => void;
    retired: boolean;
    closed: boolean;
}

/** The error a turn gets when every process slot is busy with a turn. */
export class AgentPoolFullError extends Error {
    constructor(maxLive: number) {
        super(`All ${maxLive} chat agent processes on this node are answering someone right now. Try again in a minute.`);
        this.name = 'AgentPoolFullError';
    }
}

export class AgentPool<C extends PoolClient> {
    private readonly live = new Map<string, Entry<C>>();
    /** Replaced processes that still have a turn in flight. */
    private readonly draining = new Set<Entry<C>>();
    private readonly starting = new Map<string, Promise<Entry<C>>>();
    private generations = 0;
    private timer: NodeJS.Timeout | null = null;
    private readonly now: () => number;

    constructor(private readonly opts: AgentPoolOptions) {
        this.now = opts.now ?? Date.now;
    }

    /** How many processes are running, draining ones included. */
    get size(): number {
        return this.live.size + this.draining.size;
    }

    /** The generation of the live process for this key, or null when none runs. */
    generationOf(key: string): number | null {
        const e = this.live.get(key);
        return e && !e.client.isClosed ? e.generation : null;
    }

    /**
     * The process for this key, started with `start` when none runs or the one that runs cannot be
     * used. Concurrent first turns for one key share one start rather than racing into two.
     */
    async acquire(
        key: string, start: () => Promise<PoolStart<C>>, opts: { evictIdle: boolean },
    ): Promise<AgentLease<C>> {
        this.ensureTimer();
        let entry = this.usable(key);
        if (!entry) {
            let pending = this.starting.get(key);
            if (!pending) {
                pending = this.startEntry(key, start, opts.evictIdle).finally(() => { this.starting.delete(key); });
                this.starting.set(key, pending);
            }
            entry = await pending;
        }
        entry.active++;
        entry.lastUsed = this.now();
        let released = false;
        return {
            client: entry.client,
            generation: entry.generation,
            release: () => {
                if (released) return;
                released = true;
                entry.active--;
                entry.lastUsed = this.now();
                if (entry.retired && entry.active === 0) this.closeEntry(entry, 'its replacement is running');
            },
        };
    }

    /** Replace this key's process: closed now when idle, after its last turn otherwise. */
    retire(key: string): void {
        const e = this.live.get(key);
        if (e) this.retireEntry(e, 'retired');
    }

    /** Retire every process whose key `keep` refuses (the route changed between shared and per person). */
    retireAllExcept(keep: (key: string) => boolean): void {
        for (const e of [...this.live.values()]) if (!keep(e.key)) this.retireEntry(e, 'the chat route changed');
    }

    /** Close the processes that have been idle too long, and drop the ones that exited. */
    sweep(): void {
        const now = this.now();
        for (const e of [...this.live.values()]) {
            if (e.client.isClosed) this.closeEntry(e, 'the process exited');
            else if (e.evictIdle && e.active === 0 && now - e.lastUsed >= this.opts.idleMs) this.closeEntry(e, 'idle');
        }
        for (const e of [...this.draining]) if (e.client.isClosed) this.closeEntry(e, 'the process exited');
    }

    /** Stop every process. Called from the node's shutdown hook. */
    closeAll(): void {
        for (const e of [...this.live.values(), ...this.draining]) this.closeEntry(e, 'the node is stopping');
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** The live process for this key when it can take a turn; otherwise it is dropped or retired. */
    private usable(key: string): Entry<C> | null {
        const e = this.live.get(key);
        if (!e) return null;
        if (e.client.isClosed) {
            logger.warn(`[chat] agent process for "${key}" is gone (generation ${e.generation}); starting another`);
            this.closeEntry(e, 'the process exited');
            return null;
        }
        if (e.expiresAt !== undefined && e.expiresAt - this.now() < this.opts.renewBeforeMs) {
            this.retireEntry(e, 'its credential expires soon');
            return null;
        }
        return e;
    }

    private async startEntry(key: string, start: () => Promise<PoolStart<C>>, evictIdle: boolean): Promise<Entry<C>> {
        this.makeRoom();
        const started = await start();
        const entry: Entry<C> = {
            key, client: started.client, generation: ++this.generations, lastUsed: this.now(), active: 0,
            evictIdle, retired: false, closed: false,
            ...(started.expiresAt !== undefined ? { expiresAt: started.expiresAt } : {}),
            ...(started.onClose ? { onClose: started.onClose } : {}),
        };
        this.live.set(key, entry);
        logger.info(`[chat] agent process for "${key}" started (generation ${entry.generation}, ${this.size} running)`);
        return entry;
    }

    /**
     * Keep the count under the ceiling before a new process starts: close the process idle longest,
     * or refuse when every one has a turn in flight.
     */
    private makeRoom(): void {
        this.sweep();
        // Runs before this start is registered in `starting`, so `starting` holds other keys' starts:
        // the running ones, the ones on their way, and this one must fit under the ceiling.
        while (this.size + this.starting.size + 1 > this.opts.maxLive) {
            const idle = [...this.live.values()].filter((e) => e.active === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
            if (!idle) throw new AgentPoolFullError(this.opts.maxLive);
            this.closeEntry(idle, 'the node needed its slot');
        }
    }

    private retireEntry(e: Entry<C>, reason: string): void {
        if (this.live.get(e.key) === e) this.live.delete(e.key);
        e.retired = true;
        if (e.active === 0) this.closeEntry(e, reason);
        else this.draining.add(e);
    }

    private closeEntry(e: Entry<C>, reason: string): void {
        if (this.live.get(e.key) === e) this.live.delete(e.key);
        this.draining.delete(e);
        if (e.closed) return;
        e.closed = true;
        e.client.close();
        try {
            e.onClose?.();
        } catch (err) {
            logger.warn(`[chat] closing the agent process for "${e.key}" failed a step: ${(err as Error).message}`);
        }
        logger.info(`[chat] agent process for "${e.key}" closed (generation ${e.generation}): ${reason}`);
    }

    /** The idle sweep, once a minute. Unref'd, so it never holds the node open. */
    private ensureTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.sweep(), Math.min(60_000, Math.max(1_000, this.opts.idleMs / 2)));
        this.timer.unref?.();
    }
}
