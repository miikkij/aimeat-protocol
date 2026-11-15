/**
 * @file test/unit/work-task-bridge-input.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task the work bridge builds from a work item's input (services/work/task-bridge.ts).
 *   New work carries an object input (decision 2026-11-15), and each field becomes one task field;
 *   a nested object or array becomes its JSON, never "[object Object]". A row stored before the rule
 *   may hold a string, a number, an array or null: that becomes one field `input` holding its JSON.
 * @usage cd aimeat && pnpm exec vitest run test/unit/work-task-bridge-input.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { createTaskFromWork } from '../../src/services/work/task-bridge.js';
import type { Storage, WorkRecord, AgentTaskRecord } from '../../src/storage/interface.js';

const AGENT = 'translator#alice@aimeat-test-001';

async function scopeFor(input: unknown): Promise<AgentTaskRecord['scope']> {
    const created: AgentTaskRecord[] = [];
    const storage = {
        getAgentDirectives: async () => ({ purpose: 'translate' }),
        getAction: async () => ({ displayName: 'Translate' }),
        createAgentTask: async (r: AgentTaskRecord) => { created.push(r); return r; },
    } as unknown as Storage;
    const work = { trackingCode: 'tc-1', actionId: 'translate', requesterGaii: 'bob@aimeat-test-001', input } as unknown as WorkRecord;
    await createTaskFromWork(storage, work, AGENT);
    expect(created).toHaveLength(1);
    return created[0].scope;
}

describe('the work bridge turns the input into task fields', () => {
    it('makes one text field per key of an object input, keeping text as it is', async () => {
        expect(await scopeFor({ text: 'hello', count: 3, done: true })).toEqual([
            { name: 'text', value: 'hello', type: 'text' },
            { name: 'count', value: '3', type: 'text' },
            { name: 'done', value: 'true', type: 'text' },
        ]);
    });

    it('writes a nested object or array as its JSON, not as [object Object]', async () => {
        expect(await scopeFor({ options: { tone: 'formal' }, langs: ['fi', 'en'], none: null })).toEqual([
            { name: 'options', value: '{"tone":"formal"}', type: 'text' },
            { name: 'langs', value: '["fi","en"]', type: 'text' },
            { name: 'none', value: 'null', type: 'text' },
        ]);
    });

    it('gives an old row with a string, number, array or null input one field `input` holding its JSON', async () => {
        expect(await scopeFor('an old text input')).toEqual([{ name: 'input', value: '"an old text input"', type: 'text' }]);
        expect(await scopeFor(42)).toEqual([{ name: 'input', value: '42', type: 'text' }]);
        expect(await scopeFor(['a', 'b'])).toEqual([{ name: 'input', value: '["a","b"]', type: 'text' }]);
        expect(await scopeFor(null)).toEqual([{ name: 'input', value: 'null', type: 'text' }]);
    });

    it('gives an absent input no fields, as before', async () => {
        expect(await scopeFor(undefined)).toEqual([]);
    });
});
