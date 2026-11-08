/**
 * @file test/unit/context-index-line.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's context index, as an AI reads it when it connects: which contexts are
 *   named, in which order, which stay hidden from an agent, and that the instructions carry the
 *   lines only when the session can open them.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import { describe, expect, it } from 'vitest';
import { contextIndexLine, CONTEXT_INDEX_MAX, CONTEXT_TYPE, CONTEXT_STALE_DAYS, CONTEXT_CORE_LARGE } from '../../src/services/context/index-line.js';
import { instructionsFor } from '../../src/mcp/instructions.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { nodeId: 'node-1' } as AimeatConfig;

interface Row { key: string; value: unknown; visibility: string }

function storageWith(rows: Row[], seen: { owner?: string; prefix?: string } = {}): Storage {
    return {
        listMemory: async (owner: string, opts?: { prefix?: string }) => {
            seen.owner = owner;
            seen.prefix = opts?.prefix;
            return rows.filter(r => r.key.startsWith(opts?.prefix ?? ''));
        },
    } as unknown as Storage;
}

const ctx = (slug: string, shapedAt: string, visibility = 'owner', extra: Record<string, unknown> = {}): Row => ({
    key: `context.${slug}`,
    visibility,
    value: { type: CONTEXT_TYPE, name: slug.toUpperCase(), summary: `About ${slug}.`, lifecycle: { shapedAt }, ...extra },
});

describe('contextIndexLine', () => {
    it('reads the owner\'s own keys under context.', async () => {
        const seen: { owner?: string; prefix?: string } = {};
        await contextIndexLine(storageWith([], seen), config, 'alice');
        expect(seen).toEqual({ owner: 'alice@node-1', prefix: 'context.' });
    });

    it('with no contexts, tells the AI to offer one', async () => {
        const line = await contextIndexLine(storageWith([]), config, 'alice');
        expect(line).toMatch(/keeps no contexts yet/);
        expect(line).toMatch(/aimeat-context/);
    });

    it('names each context with its key and summary, newest shaped first', async () => {
        const line = await contextIndexLine(storageWith([ctx('trip', '2026-11-01'), ctx('band', '2026-11-07')]), config, 'alice');
        expect(line).toContain('- BAND (context.band): About band.');
        expect(line!.indexOf('context.band')).toBeLessThan(line!.indexOf('context.trip'));
    });

    it('leaves out a record under context. that is not a context', async () => {
        const line = await contextIndexLine(storageWith([{ key: 'context.notes', visibility: 'owner', value: { text: 'x' } }]), config, 'alice');
        expect(line).toMatch(/keeps no contexts yet/);
    });

    it('hides a private context from an agent and shows it to the owner', async () => {
        const rows = [ctx('health', '2026-11-02', 'private'), ctx('trip', '2026-11-01')];
        const toAgent = await contextIndexLine(storageWith(rows), config, 'alice', true);
        const toOwner = await contextIndexLine(storageWith(rows), config, 'alice', false);
        expect(toAgent).not.toContain('context.health');
        expect(toAgent).toContain('context.trip');
        expect(toOwner).toContain('context.health');
    });

    it('names at most CONTEXT_INDEX_MAX and says how many more there are', async () => {
        const rows = Array.from({ length: CONTEXT_INDEX_MAX + 3 }, (_, i) => ctx(`c${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`));
        const line = await contextIndexLine(storageWith(rows), config, 'alice');
        expect(line!.split('\n').filter(l => l.startsWith('- '))).toHaveLength(CONTEXT_INDEX_MAX);
        expect(line).toContain('…and 3 more');
    });

    it('marks a context untouched past CONTEXT_STALE_DAYS and one whose core grew large', async () => {
        const now = Date.parse('2026-11-08T00:00:00Z');
        const old = ctx('mokki', '2026-06-01T00:00:00Z');
        const big = ctx('hanke', '2026-11-07T00:00:00Z', 'owner', { core: 'x'.repeat(CONTEXT_CORE_LARGE + 1) });
        const fresh = ctx('trip', '2026-11-06T00:00:00Z');
        const line = await contextIndexLine(storageWith([old, big, fresh]), config, 'alice', true, now);
        const of = (k: string) => line!.split('\n').find(l => l.includes(`(context.${k})`))!;
        expect(of('mokki')).toContain(`untouched since 2026-06-01`);
        expect(of('hanke')).toContain('core has grown large');
        expect(of('trip')).not.toContain('[');
        expect(CONTEXT_STALE_DAYS).toBe(90);
    });

    it('leaves an archived context off the list', async () => {
        const archived = ctx('mokki', '2026-06-01', 'owner', { lifecycle: { shapedAt: '2026-06-01', archivedAt: '2026-11-01' } });
        const line = await contextIndexLine(storageWith([archived, ctx('trip', '2026-11-01')]), config, 'alice');
        expect(line).not.toContain('context.mokki');
        expect(line).toContain('context.trip');
    });

    it('answers null when the store cannot be read, and for no owner', async () => {
        const broken = { listMemory: async () => { throw new Error('down'); } } as unknown as Storage;
        expect(await contextIndexLine(broken, config, 'alice')).toBeNull();
        expect(await contextIndexLine(storageWith([]), config, undefined)).toBeNull();
    });
});

describe('instructionsFor with contexts', () => {
    it('carries the lines before the long form, and nothing when absent', () => {
        const lines = 'This person keeps contexts: …\n- TRIP (context.trip): About trip.';
        const withIt = instructionsFor('agent', { contexts: lines });
        const without = instructionsFor('agent', {});
        expect(withIt).toContain(lines);
        expect(withIt.indexOf(lines)).toBeLessThan(withIt.indexOf('More on memory.'));
        expect(without).not.toContain('context.trip');
        expect(withIt.replace(`${lines}\n\n`, '')).toBe(without);
    });
});
