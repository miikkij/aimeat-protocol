/**
 * @file test/unit/once-only-keep-steps.test.ts
 * @description runOnceOnlyKeepSteps (src/server-bootstrap/once-only-keep-steps.ts) resolves only after
 *   every once-only keep step has finished, so the node serves no request before a kept app holds its
 *   words; the steps run one after another in their order; a step that throws is logged and the boot
 *   goes on.
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (capability-loss review: P2 and P3 awaited before serving).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
const fail = new Set<string>();
/** A step that takes a moment, records when it finished, and throws when told to. */
const step = (name: string) => vi.fn(async () => {
    await new Promise(r => setTimeout(r, 20));
    if (fail.has(name)) throw new Error(`${name} failed`);
    order.push(name);
    return { ran: true };
});

vi.mock('../../src/services/schedule-extension-keep.js', () => ({ keepAppExtensionSchedulesOnce: step('schedules') }));
vi.mock('../../src/services/tool-scope-words-migration.js', () => ({ migrateToolScopeWordsOnce: step('toolWords') }));
vi.mock('../../src/services/rest-scope-gates-migration.js', () => ({
    migrateRestScopeGatesOnce: step('restGates'), migrateAgentReadGrantOnce: step('agentRead'),
}));
vi.mock('../../src/services/rest-scope-keep-working-migration.js', () => ({ migrateRestScopeKeepWorkingOnce: step('keepWorking') }));
vi.mock('../../src/services/app-datapackage-read-keep-migration.js', () => ({ keepDatapackageReadForAppsOnce: step('datapackageRead') }));
vi.mock('../../src/services/app-storage-read-keep-migration.js', () => ({ keepStorageReadForAppsOnce: step('storageRead') }));
vi.mock('../../src/services/app-on-done-keep-migration.js', () => ({ keepOnDoneForAppsOnce: step('onDone') }));

const { runOnceOnlyKeepSteps } = await import('../../src/server-bootstrap/once-only-keep-steps.js');
const storage = {} as never;
const config = { nodeId: 'unit-node' } as never;

describe('runOnceOnlyKeepSteps', () => {
    beforeEach(() => { order.length = 0; fail.clear(); });

    it('resolves only after the data-package and on_done keep steps have finished, in the chain order', async () => {
        await runOnceOnlyKeepSteps(storage, config);
        expect(order).toEqual(['schedules', 'toolWords', 'restGates', 'agentRead', 'keepWorking', 'datapackageRead', 'storageRead', 'onDone']);
    });

    it('a throwing step is logged and the boot goes on (the promise resolves)', async () => {
        fail.add('schedules');
        fail.add('restGates');
        await expect(runOnceOnlyKeepSteps(storage, config)).resolves.toBeUndefined();
        // The schedule step failing does not stop the scope chain; a failure inside the chain stops the
        // rest of it, as it always has, and the next start tries again.
        expect(order).toEqual(['toolWords']);
    });
});
