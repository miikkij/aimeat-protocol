/**
 * @file test/unit/chat-agent-pool.test.ts
 * @description Unit tests for the chat agent processes (src/services/chat-agent-pool.ts): one process
 *   per key, reused by the same key and never shared with another; closed when idle, never while a
 *   turn runs; a ceiling that closes the process idle longest and refuses when every one is busy; a
 *   dead process replaced; a process whose credential expires soon replaced after its last turn.
 *
 *   The processes are fakes with the two things the pool uses (isClosed, close). What goose does with
 *   its environment is covered by goose-env.test.ts and, end to end, by test/e2e-chat-agent.ts.
 * @usage cd aimeat && pnpm vitest run test/unit/chat-agent-pool.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial. System 2 plan, V5.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AgentPool, AgentPoolFullError, type PoolClient, type PoolStart } from '../../src/services/chat-agent-pool.js';

class FakeProcess implements PoolClient {
    closed = false;
    constructor(readonly owner: string, readonly token: string) {}
    get isClosed(): boolean { return this.closed; }
    close(): void { this.closed = true; }
}

let clock = 1_000_000;
const pools: Array<AgentPool<FakeProcess>> = [];

function makePool(over: { idleMs?: number; maxLive?: number; renewBeforeMs?: number } = {}) {
    const pool = new AgentPool<FakeProcess>({
        idleMs: over.idleMs ?? 15 * 60_000, maxLive: over.maxLive ?? 20,
        renewBeforeMs: over.renewBeforeMs ?? 20 * 60_000, now: () => clock,
    });
    pools.push(pool);
    return pool;
}

/** A starter that makes one process per call, carrying the owner's own token, and counts the calls. */
function starter(owner: string, opts: { expiresAt?: number } = {}) {
    const started: FakeProcess[] = [];
    const revoked: string[] = [];
    const start = async (): Promise<PoolStart<FakeProcess>> => {
        const p = new FakeProcess(owner, `tok-${owner}-${started.length + 1}`);
        started.push(p);
        return {
            client: p, ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
            onClose: () => { revoked.push(p.token); },
        };
    };
    return { start, started, revoked };
}

afterEach(() => {
    for (const p of pools.splice(0)) p.closeAll();
});

describe('one process per person', () => {
    it('gives two people two processes, each with that person\'s own token', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const bob = starter('bob');
        const a = await pool.acquire('alice', alice.start, { evictIdle: true });
        const b = await pool.acquire('bob', bob.start, { evictIdle: true });
        expect(a.client).not.toBe(b.client);
        expect(a.client.token).toBe('tok-alice-1');
        expect(b.client.token).toBe('tok-bob-1');
        expect(a.generation).not.toBe(b.generation);
        expect(pool.size).toBe(2);
        a.release(); b.release();
    });

    it('reuses the same person\'s process, and never hands it to another person', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const bob = starter('bob');
        const first = await pool.acquire('alice', alice.start, { evictIdle: true });
        first.release();
        const second = await pool.acquire('alice', alice.start, { evictIdle: true });
        expect(second.client).toBe(first.client);
        expect(alice.started).toHaveLength(1);
        const theirs = await pool.acquire('bob', bob.start, { evictIdle: true });
        expect(theirs.client.owner).toBe('bob');
        expect(theirs.client.token).not.toContain('alice');
        second.release(); theirs.release();
    });

    it('starts once when the same person\'s first two turns arrive together', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const [x, y] = await Promise.all([
            pool.acquire('alice', alice.start, { evictIdle: true }),
            pool.acquire('alice', alice.start, { evictIdle: true }),
        ]);
        expect(x.client).toBe(y.client);
        expect(alice.started).toHaveLength(1);
        x.release(); y.release();
    });
});

describe('idle processes close', () => {
    it('closes a process idle past the timeout, revokes its token, and starts a fresh one next time', async () => {
        const pool = makePool({ idleMs: 15 * 60_000 });
        const alice = starter('alice');
        const lease = await pool.acquire('alice', alice.start, { evictIdle: true });
        const gen = lease.generation;
        lease.release();

        clock += 14 * 60_000;
        pool.sweep();
        expect(alice.started[0].isClosed).toBe(false);

        clock += 60_000;
        pool.sweep();
        expect(alice.started[0].isClosed).toBe(true);
        expect(alice.revoked).toEqual(['tok-alice-1']);
        expect(pool.size).toBe(0);
        expect(pool.generationOf('alice')).toBeNull();

        const next = await pool.acquire('alice', alice.start, { evictIdle: true });
        expect(next.client.token).toBe('tok-alice-2');
        expect(next.generation).toBeGreaterThan(gen);
        next.release();
    });

    it('never closes a process while a turn is in flight', async () => {
        const pool = makePool({ idleMs: 1_000 });
        const alice = starter('alice');
        const lease = await pool.acquire('alice', alice.start, { evictIdle: true });
        clock += 60 * 60_000;
        pool.sweep();
        expect(lease.client.isClosed).toBe(false);
        lease.release();
        clock += 1_000;
        pool.sweep();
        expect(lease.client.isClosed).toBe(true);
    });

    it('keeps the shared process up however long it is idle', async () => {
        const pool = makePool({ idleMs: 1_000 });
        const shared = starter('*');
        const lease = await pool.acquire('*', shared.start, { evictIdle: false });
        lease.release();
        clock += 24 * 60 * 60_000;
        pool.sweep();
        expect(lease.client.isClosed).toBe(false);
    });
});

describe('the ceiling', () => {
    it('closes the process idle longest to make room', async () => {
        const pool = makePool({ maxLive: 2 });
        const alice = starter('alice');
        const bob = starter('bob');
        const carol = starter('carol');
        (await pool.acquire('alice', alice.start, { evictIdle: true })).release();
        clock += 1_000;
        (await pool.acquire('bob', bob.start, { evictIdle: true })).release();
        clock += 1_000;
        const c = await pool.acquire('carol', carol.start, { evictIdle: true });
        expect(alice.started[0].isClosed).toBe(true);
        expect(bob.started[0].isClosed).toBe(false);
        expect(pool.size).toBe(2);
        c.release();
    });

    it('refuses a new person when every process has a turn in flight, and starts nothing', async () => {
        const pool = makePool({ maxLive: 2 });
        const a = await pool.acquire('alice', starter('alice').start, { evictIdle: true });
        const b = await pool.acquire('bob', starter('bob').start, { evictIdle: true });
        const carol = starter('carol');
        await expect(pool.acquire('carol', carol.start, { evictIdle: true })).rejects.toBeInstanceOf(AgentPoolFullError);
        expect(carol.started).toHaveLength(0);
        expect(a.client.isClosed).toBe(false);
        expect(b.client.isClosed).toBe(false);
        a.release(); b.release();
    });
});

describe('replacing a process', () => {
    it('replaces a process that exited', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const lease = await pool.acquire('alice', alice.start, { evictIdle: true });
        lease.release();
        alice.started[0].closed = true;
        const next = await pool.acquire('alice', alice.start, { evictIdle: true });
        expect(next.client).not.toBe(lease.client);
        expect(next.generation).not.toBe(lease.generation);
        expect(alice.revoked).toEqual(['tok-alice-1']);
        next.release();
    });

    it('replaces a process whose token expires soon, after its turn in flight ends', async () => {
        const pool = makePool({ renewBeforeMs: 20 * 60_000 });
        const alice = starter('alice', { expiresAt: clock + 30 * 60_000 });
        const running = await pool.acquire('alice', alice.start, { evictIdle: true });

        clock += 15 * 60_000;
        const next = await pool.acquire('alice', alice.start, { evictIdle: true });
        expect(next.client).not.toBe(running.client);
        // The old one still has a turn in flight, so it keeps running until that turn ends.
        expect(running.client.isClosed).toBe(false);
        expect(pool.size).toBe(2);
        running.release();
        expect(running.client.isClosed).toBe(true);
        expect(alice.revoked).toEqual(['tok-alice-1']);
        next.release();
    });

    it('closes everything on shutdown and revokes every token', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const bob = starter('bob');
        (await pool.acquire('alice', alice.start, { evictIdle: true })).release();
        const b = await pool.acquire('bob', bob.start, { evictIdle: true });
        pool.closeAll();
        expect(alice.started[0].isClosed && bob.started[0].isClosed).toBe(true);
        expect([...alice.revoked, ...bob.revoked].sort()).toEqual(['tok-alice-1', 'tok-bob-1']);
        b.release();
    });

    it('retires the per-person processes when the route changes to the shared key', async () => {
        const pool = makePool();
        const alice = starter('alice');
        const a = await pool.acquire('alice', alice.start, { evictIdle: true });
        pool.retireAllExcept((key) => key === '*');
        expect(a.client.isClosed).toBe(false);
        a.release();
        expect(a.client.isClosed).toBe(true);
    });
});
