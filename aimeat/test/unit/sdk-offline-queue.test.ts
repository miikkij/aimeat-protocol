/**
 * @file sdk-offline-queue.test.ts
 * @description The waiting changes of the served library aimeat-offline (src/static/sdk-libs/offline/
 *   queue.js): kept in order across a reload, sent a record's batch at a time, left in place when a
 *   send gets no answer, tried again when the network returns, and never lost when a send is refused.
 *   The storage and the network are handed in, so the code under test is the code the browser runs.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { createQueue } from '../../src/static/sdk-libs/offline/queue.js';

type Kept = { items: Array<{ n: number; value: any }>; seq: number } | null;

/** A device store behind one variable, a network switch, and a timer that runs when told. */
function bench(initial: Kept = null) {
    const world = { kept: initial as Kept, online: true, sent: [] as any[][], answer: true as boolean | (() => boolean | Promise<boolean>), timers: [] as Array<() => void> };
    const make = (send?: (batch: any[]) => boolean | Promise<boolean>) => createQueue({
        load: async () => world.kept,
        save: async (state) => { world.kept = JSON.parse(JSON.stringify(state)); },
        send: send ?? ((batch) => { world.sent.push(batch); return typeof world.answer === 'function' ? world.answer() : world.answer; }),
        group: (entry) => entry.record,
        online: () => world.online,
        setTimer: (fn) => { world.timers.push(fn); return world.timers.length; },
        clearTimer: () => undefined,
    });
    return { world, make };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AIMEAT.offline.queue', () => {
    it('sends the oldest change with the ones that follow it for the same record, then the next record', async () => {
        const { world, make } = bench();
        world.online = false;
        const q = make();
        q.push({ record: 'a', id: 1 }); q.push({ record: 'a', id: 2 }); q.push({ record: 'b', id: 3 }); q.push({ record: 'a', id: 4 });
        await q.flush();
        expect(world.sent).toEqual([]);
        expect(q.state()).toMatchObject({ waiting: 4, reachable: false });
        world.online = true;
        expect(await q.flush()).toBe(true);
        expect(world.sent.map((b) => b.map((e) => e.id))).toEqual([[1, 2], [3], [4]]);
        expect(q.size()).toBe(0);
        expect(world.kept?.items).toEqual([]);
    });

    it('keeps everything when a send gets no answer, and sends it when the network returns', async () => {
        const { world, make } = bench();
        world.answer = false;
        const q = make();
        await q.push({ record: 'a', id: 1 });
        await settle();
        expect(q.state()).toMatchObject({ waiting: 1, reachable: false, busy: false });
        expect(world.kept?.items.length).toBe(1);
        expect(world.timers.length).toBe(1);   // one delayed try, no loop
        world.answer = true;
        q.networkChanged(true);
        await settle(); await settle();
        expect(q.size()).toBe(0);
        expect(q.state().reachable).toBe(true);
    });

    it('a send that throws is no answer: nothing leaves the list', async () => {
        const { world, make } = bench();
        let calls = 0;
        const q = make(() => { calls += 1; throw new Error('Failed to fetch'); });
        await q.push({ record: 'a', id: 1 });
        await settle();
        expect(calls).toBe(1);
        expect(q.size()).toBe(1);
        expect(world.kept?.items.length).toBe(1);
    });

    it('a reload finds the waiting changes in their order and numbers new ones after them', async () => {
        const { world, make } = bench();
        world.online = false;
        const first = make();
        await first.push({ record: 'a', id: 1 });
        await first.push({ record: 'b', id: 2 });
        first.destroy();
        const again = make();
        again.push({ record: 'b', id: 3 });   // pushed before the kept list is read
        await again.ready;
        expect(again.items().map((e) => e.id)).toEqual([1, 2, 3]);
        world.online = true;
        await again.flush();
        expect(world.sent.map((b) => b.map((e) => e.id))).toEqual([[1], [2, 3]]);
        expect(world.kept?.items).toEqual([]);
        expect(world.kept?.seq).toBe(3);
    });

    it('drop takes out the changes that waited for a refused one, and says how many', async () => {
        const { world, make } = bench();
        world.online = false;
        const q = make();
        await q.push({ record: 'a', id: 1 });
        await q.push({ record: 'b', id: 2, needs: 1 });
        await q.push({ record: 'b', id: 3 });
        expect(q.drop((e) => e.needs === 1)).toBe(1);
        expect(q.items().map((e) => e.id)).toEqual([1, 3]);
        await settle();
        expect(world.kept?.items.map((e) => e.value.id)).toEqual([1, 3]);
    });

    it('tells its listeners of every change and stops when asked', async () => {
        const { world, make } = bench();
        world.online = false;
        const q = make();
        let heard = 0;
        const stop = q.on(() => { heard += 1; });
        await q.push({ record: 'a', id: 1 });
        const afterPush = heard;
        expect(afterPush).toBeGreaterThan(0);
        stop();
        await q.push({ record: 'a', id: 2 });
        expect(heard).toBe(afterPush);
    });
});
