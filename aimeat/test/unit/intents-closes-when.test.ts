/**
 * @file test/unit/intents-closes-when.test.ts
 * @description The three conditions a system-suggested intent can close itself on, each asserted in
 *   BOTH directions.
 *
 *   These are evaluated on read and never stored, which is the whole point: a suggestion whose
 *   situation unwinds — the agent is deleted, the portfolio page is removed — has to come back.
 *   A stored "done" could not do that, and would quietly leave the person believing a step was
 *   handled when it no longer is. So the false direction matters as much as the true one, and both
 *   are here for all three.
 * @usage pnpm test -- intents-closes-when
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, checklist 1.7).
 */
import { describe, it, expect } from 'vitest';
import { evaluateCloses, CLOSES_CHECKS } from '../../src/services/intents.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { nodeId: 'aimeat-local-001-dev' } as AimeatConfig;
const OWNER = 'tester';

/**
 * A storage stub with only what evaluateCloses touches. Deliberately minimal: anything it reaches
 * for that is not listed here throws, so a check that starts consulting something new fails loudly
 * instead of silently reading undefined.
 */
function stubStorage(over: Partial<Record<string, unknown>> = {}): Storage {
    const base: Record<string, unknown> = {
        getMemory: async () => null,
        listMemory: async () => [],
        listMemoryForOwners: async () => [],
        getStorageFile: async () => null,
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        ...over,
    };
    return new Proxy(base, {
        get(target, prop: string) {
            if (prop in target) return target[prop];
            throw new Error(`evaluateCloses reached for storage.${prop}, which this stub does not model`);
        },
    }) as unknown as Storage;
}

describe('hello_mcp — has an agent proved the connection?', () => {
    it('true when the proof key exists', async () => {
        const storage = stubStorage({
            getMemory: async (_gaii: string, key: string) =>
                (key === 'onboarding.hello_mcp' ? { key, value: { at: 'now' } } : null),
        });
        expect(await evaluateCloses(storage, config, OWNER, 'hello_mcp')).toBe(true);
    });

    it('false when it does not', async () => {
        expect(await evaluateCloses(stubStorage(), config, OWNER, 'hello_mcp')).toBe(false);
    });
});

describe('welcome_mat — is there actually a page?', () => {
    it('true when the portfolio FILE exists', async () => {
        const storage = stubStorage({ getStorageFile: async () => ({ key: 'portfolio.html' }) });
        expect(await evaluateCloses(storage, config, OWNER, 'welcome_mat')).toBe(true);
    });

    it('false when there is no file — the marker alone is not the page', async () => {
        // A paste marker says an attempt happened; the file says a page exists. Reading the marker
        // would keep a deleted portfolio looking done forever.
        const storage = stubStorage({
            getMemory: async () => ({ key: 'onboarding.welcome_mat_pasted', value: { attempts: 3 } }),
            getStorageFile: async () => null,
        });
        expect(await evaluateCloses(storage, config, OWNER, 'welcome_mat')).toBe(false);
    });
});

describe('first_agent — is anyone connected?', () => {
    it('true with at least one agent', async () => {
        const storage = stubStorage({ getAgentsByOwner: async () => [{ gaii: 'a#o@n' }] });
        expect(await evaluateCloses(storage, config, OWNER, 'first_agent')).toBe(true);
    });

    it('false with none', async () => {
        expect(await evaluateCloses(stubStorage(), config, OWNER, 'first_agent')).toBe(false);
    });

    it('FALSE AGAIN once the last agent is removed — the suggestion comes back', async () => {
        const withAgent = stubStorage({ getAgentsByOwner: async () => [{ gaii: 'a#o@n' }] });
        expect(await evaluateCloses(withAgent, config, OWNER, 'first_agent')).toBe(true);
        const without = stubStorage({ getAgentsByOwner: async () => [] });
        expect(await evaluateCloses(without, config, OWNER, 'first_agent')).toBe(false);
    });
});

describe('the vocabulary is closed', () => {
    it('names exactly the three checks the route validates against', () => {
        expect([...CLOSES_CHECKS].sort()).toEqual(['first_agent', 'hello_mcp', 'welcome_mat']);
    });

    it('an unknown check is false rather than throwing', async () => {
        // The route rejects one at the door; this is the second line, so a record written before a
        // check was retired degrades to "still worth suggesting" instead of crashing the list.
        expect(await evaluateCloses(stubStorage(), config, OWNER, 'made_up' as never)).toBe(false);
    });
});
