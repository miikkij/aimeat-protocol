/**
 * @file test/unit/home-waiting.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description homeWaitingFor (src/services/home/waiting.ts), the one answer GET /v1/home/waiting and
 *   aimeat_home_waiting give: the order of the items (decide, answer, look; newest first inside a
 *   group), the cap with `total` and `by_kind` counting everything, a failing source named in
 *   `partial` while the rest answers, a source the caller may not read named in `withheld`, and the
 *   shown names of people read only for the items that are kept.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { homeWaitingFor, WAITING_SOURCES, type WaitingSource, type WaitingRow, type WaitingKind } from '../../src/services/home/waiting.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'node-test';
const looked: string[] = [];
const storage = {
    getGHIIByOwner: async (name: string) => {
        looked.push(name);
        return name === 'bob' ? { username: 'bob', displayName: 'Bob Builder' } : null;
    },
} as unknown as Storage;
const config = { nodeId: NODE } as unknown as AimeatConfig;
const deps = { storage, config };
const alice = callerFromAuth({ sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] }, NODE, storage);
const agent = callerFromAuth({ sub: `helper#alice@${NODE}`, owner: 'alice', roles: ['agent'], scopes: ['memory:read'] }, NODE, storage);

/** A source that answers these rows. */
const source = (kind: WaitingKind, rows: Array<Partial<WaitingRow>>, readable: WaitingSource['readable'] = () => true): WaitingSource => ({
    kind, readable,
    read: async () => rows.map((r, i) => ({ kind, id: `${kind}-${i}`, group: 'answer', subject: `${kind} ${i}`, href: '/v1/home', ...r }) as WaitingRow),
});

describe('homeWaitingFor', () => {
    it('lists decide first, then answer, then look, newest first inside a group', async () => {
        const out = await homeWaitingFor(deps, alice, { sources: [
            source('unread', [{ group: 'look', count: 4 }]),
            source('reply', [
                { group: 'answer', at: '2026-11-20T10:00:00Z' },
                { group: 'answer', at: '2026-11-24T10:00:00Z' },
            ]),
            source('agent_proposal', [
                { group: 'decide', at: '2026-11-01T10:00:00Z' },
                { group: 'decide', at: '2026-11-23T10:00:00Z' },
            ]),
            source('team', [{ group: 'answer', count: 2 }]),
        ] });
        expect(out.items.map(i => `${i.group}:${i.id}`)).toEqual([
            'decide:agent_proposal-1', 'decide:agent_proposal-0',
            'answer:reply-1', 'answer:reply-0', 'answer:team-0',
            'look:unread-0',
        ]);
        expect(out.by_kind).toEqual({ unread: 4, reply: 2, agent_proposal: 2, team: 2 });
        // The decide and answer rows, the team row by its count; the unread count stands apart,
        // because an unread message can sit in a thread that already waits for an answer.
        expect(out.total).toBe(6);
        expect(out.to_open).toBe(4);
        expect(out.partial).toBeUndefined();
        expect(out.withheld).toBeUndefined();
        expect(out.note).toMatch(/act_with/);
    });

    it('stops the items at the limit while total and by_kind count everything', async () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ group: 'decide' as const, at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString() }));
        const out = await homeWaitingFor(deps, alice, { limit: 5, sources: [source('invitation', many), source('unread', [{ group: 'look', count: 7 }])] });
        expect(out.items).toHaveLength(5);
        expect(out.items[0].id).toBe('invitation-29');
        expect(out.total).toBe(30);
        expect(out.to_open).toBe(7);
        expect(out.by_kind).toEqual({ invitation: 30, unread: 7 });
        // Out of range is held to 1..50, as the route clamps it.
        expect((await homeWaitingFor(deps, alice, { limit: 500, sources: [source('invitation', many)] })).items).toHaveLength(30);
        expect((await homeWaitingFor(deps, alice, { limit: 0, sources: [source('invitation', many)] })).items).toHaveLength(20);
    });

    it('names a failing source in partial, and the other kinds still answer', async () => {
        const broken: WaitingSource = { kind: 'help_question', readable: () => true, read: async () => { throw new Error('store down'); } };
        const out = await homeWaitingFor(deps, alice, { sources: [broken, source('reply', [{}])] });
        expect(out.partial).toEqual(['help_question']);
        expect(out.by_kind).toEqual({ reply: 1 });
        expect(out.items.map(i => i.kind)).toEqual(['reply']);
        expect(out.total).toBe(1);
    });

    it('answers no list when every kind it may read failed: zero items would say that nothing waits', async () => {
        const down = (kind: WaitingKind): WaitingSource => ({ kind, readable: () => true, read: async () => { throw new Error(`${kind} store down`); } });
        await expect(homeWaitingFor(deps, alice, { sources: [down('help_question'), down('reply')] })).rejects.toThrow(/store down/);
        // A kind the caller may not read is withheld, not failed: it does not make the answer an error.
        const out = await homeWaitingFor(deps, alice, { sources: [source('reply', [{}]), source('team', [], () => false)] });
        expect(out.withheld).toEqual(['team']);
        expect(out.total).toBe(1);
    });

    it('names a kind the caller may not read in withheld, never as zero', async () => {
        const out = await homeWaitingFor(deps, agent, { sources: [
            source('agent_sign_in', [{ group: 'decide' }], c => c.has('memory:read')),
            source('workflow_input', [{}], c => c.has('workflow:read')),
        ] });
        expect(out.withheld).toEqual(['workflow_input']);
        expect(out.by_kind).toEqual({ agent_sign_in: 1 });
        expect('workflow_input' in out.by_kind).toBe(false);
    });

    it('reads the shown names of people only for the kept items, and falls back to the handle', async () => {
        looked.length = 0;
        const out = await homeWaitingFor(deps, alice, { limit: 2, sources: [source('reply', [
            { at: '2026-11-24T00:00:00Z', fromAccount: `bob@${NODE}` },
            { at: '2026-11-23T00:00:00Z', fromAccount: `carol@${NODE}` },
            { at: '2026-11-01T00:00:00Z', fromAccount: `dave@${NODE}` },
        ])] });
        expect(out.items.map(i => i.from)).toEqual(['Bob Builder', 'carol']);
        expect(looked.sort()).toEqual(['bob', 'carol']);
        expect(JSON.stringify(out)).not.toContain('fromAccount');
    });

    it('lists every kind of the contract once, each source reading the word its route asks', () => {
        expect(WAITING_SOURCES.map(s => s.kind).sort()).toEqual([
            'agent_proposal', 'agent_sign_in', 'help_question', 'invitation', 'open_item',
            'publish_request', 'reply', 'team', 'unread', 'workflow_input',
        ]);
        // The person in person reads every kind; an agent holding only memory:read reads the two its word covers.
        expect(WAITING_SOURCES.filter(s => !s.readable(alice, deps)).map(s => s.kind)).toEqual([]);
        expect(WAITING_SOURCES.filter(s => s.readable(agent, deps)).map(s => s.kind).sort()).toEqual(['agent_proposal', 'agent_sign_in']);
    });
});
