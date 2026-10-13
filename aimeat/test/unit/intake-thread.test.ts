/**
 * @file test/unit/intake-thread.test.ts
 * @description The parts of a conversation through an intake form that need no node: the settings
 *   a form carries, the visitor's secret and the record id made from it, and how the two records
 *   are read into the turns a visitor sees.
 *
 *   The properties that matter here are refusals. A token is 43 characters of one alphabet and
 *   anything else opens nothing, an object or a record id included. The reply record is written by
 *   a member, so everything in it that is not a turn's text, time and role is dropped, and a
 *   record that is not shaped as expected reads as an open conversation with no answers.
 * @usage pnpm test -- intake-thread
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the October agents plan, P4).
 */
import { describe, it, expect } from 'vitest';
import {
    THREAD_DEFAULTS, THREAD_CEILINGS, parseThreadConfig, newThreadToken, threadIdOf, cleanTurnText, turnsOfThread, replyState,
    composeTurns, threadIsExpired,
} from '../../src/services/intake-thread.js';

describe('the conversation settings of a form', () => {
    const base = { reply_namespace: 'chat.replies', signal_namespace: 'chat.signals' };

    it('fills the defaults and keeps the two spaces', () => {
        const out = parseThreadConfig(base, 'chat.threads');
        expect(out).toEqual({ ok: true, thread: { replyNamespace: 'chat.replies', signalNamespace: 'chat.signals', maxTurns: THREAD_DEFAULTS.maxTurns, maxChars: THREAD_DEFAULTS.maxChars, ttlDays: THREAD_DEFAULTS.ttlDays, maxAgentTurnsPerDay: THREAD_DEFAULTS.maxAgentTurnsPerDay } });
    });

    it('holds every number under its ceiling, and reads a number that is not one as the default', () => {
        const out = parseThreadConfig({ ...base, max_turns: 5000, max_chars: 1e9, ttl_days: 0, max_agent_turns_per_day: '7' }, 'chat.threads');
        expect(out.ok && out.thread.maxTurns).toBe(THREAD_CEILINGS.maxTurns);
        expect(out.ok && out.thread.maxChars).toBe(THREAD_CEILINGS.maxChars);
        expect(out.ok && out.thread.ttlDays).toBe(THREAD_DEFAULTS.ttlDays);
        expect(out.ok && out.thread.maxAgentTurnsPerDay).toBe(THREAD_DEFAULTS.maxAgentTurnsPerDay);
    });

    it('refuses a missing space, a meta space, and the same space twice', () => {
        expect(parseThreadConfig({ reply_namespace: 'chat.replies' }, 'chat.threads').ok).toBe(false);
        expect(parseThreadConfig({ ...base, signal_namespace: 'meta.signals' }, 'chat.threads').ok).toBe(false);
        expect(parseThreadConfig({ ...base, reply_namespace: 'chat.threads' }, 'chat.threads').ok).toBe(false);
        expect(parseThreadConfig({ ...base, signal_namespace: 'chat.replies' }, 'chat.threads').ok).toBe(false);
        expect(parseThreadConfig({ ...base, signal_namespace: 'chat signals' }, 'chat.threads').ok).toBe(false);
        for (const bad of [null, 'yes', true, [base]]) expect(parseThreadConfig(bad, 'chat.threads').ok).toBe(false);
    });
});

describe('the visitor\'s secret', () => {
    it('a token gives one record id, and the id does not contain the token', () => {
        const token = newThreadToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const id = threadIdOf(token);
        expect(id).toMatch(/^t[0-9a-f]{40}$/);
        expect(threadIdOf(token)).toBe(id);
        expect(id).not.toContain(token.slice(0, 10));
        expect(threadIdOf(newThreadToken())).not.toBe(id);
    });

    it('anything that is not a token opens nothing', () => {
        const id = threadIdOf(newThreadToken()) as string;
        for (const bad of [undefined, null, '', 'short', id, 'a'.repeat(44), 'a'.repeat(42) + '!', { $ne: '' }, ['a'.repeat(43)], 43]) {
            expect(threadIdOf(bad)).toBe(null);
        }
    });
});

describe('a visitor\'s message', () => {
    it('is trimmed, and loses the control characters a database cannot store', () => {
        expect(cleanTurnText('  Hello\u0000 there\n ', 100)).toEqual({ ok: true, text: 'Hello there' });
    });
    it('is refused when it is empty, not a string, or past the form\'s limit', () => {
        expect(cleanTurnText('   ', 100).ok).toBe(false);
        expect(cleanTurnText({ text: 'x' }, 100).ok).toBe(false);
        expect(cleanTurnText('x'.repeat(101), 100).ok).toBe(false);
        expect(cleanTurnText('x'.repeat(100), 100).ok).toBe(true);
    });
});

describe('what the visitor reads back', () => {
    const t = (n: number) => new Date(Date.UTC(2026, 9, 13, 8, 0, n)).toISOString();

    it('both sides in time order, the visitor first when two turns share a time', () => {
        const visitor = turnsOfThread({ turns: [{ text: 'one', at: t(0) }, { text: 'three', at: t(5) }] });
        const state = replyState({ replies: [{ text: 'four', at: t(5) }, { text: 'two', at: t(2), role: 'person' }] });
        expect(composeTurns(visitor, state.replies).map((x) => `${x.role}:${x.text}`)).toEqual(['visitor:one', 'person:two', 'visitor:three', 'agent:four']);
    });

    it('a turn carries role, text and time and nothing else that the record holds', () => {
        const state = replyState({ handler: 'person', closed: true, internal: 'x', replies: [{ text: 'hi', at: t(1), role: 'admin', note: 'private' }] });
        expect(state).toEqual({ handler: 'person', closed: true, replies: [{ role: 'agent', text: 'hi', at: t(1) }] });
        expect(turnsOfThread({ turns: [{ text: 'a', at: t(0), ip: '1.2.3.4', role: 'agent' }] })).toEqual([{ role: 'visitor', text: 'a', at: t(0) }]);
    });

    it('a record that is not shaped as expected is an open conversation with no answers', () => {
        for (const bad of [undefined, null, 'x', [], { replies: 'no' }, { replies: [{ text: '', at: t(0) }, { text: 'x' }, { text: 'x', at: 'yesterday' }, null] }, { handler: 'robot', closed: 'yes' }]) {
            expect(replyState(bad)).toEqual({ handler: 'agent', closed: false, replies: [] });
        }
        expect(turnsOfThread(null)).toEqual([]);
        expect(turnsOfThread({ turns: [{ text: 1, at: t(0) }, { text: 'x', at: 5 }] })).toEqual([]);
    });
});

describe('how a conversation goes stale', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 9, 13);
    it('it is kept for the form\'s days after its last visitor turn, and is past them after that', () => {
        const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
        expect(threadIsExpired({ updated_at: at(29), turns: [] }, now, 30)).toBe(false);
        expect(threadIsExpired({ updated_at: at(31), turns: [] }, now, 30)).toBe(true);
        expect(threadIsExpired({ turns: [{ text: 'x', at: at(40) }, { text: 'y', at: at(2) }] }, now, 30)).toBe(false);
        expect(threadIsExpired({ turns: [{ text: 'x', at: at(40) }] }, now, 30)).toBe(true);
        expect(threadIsExpired({}, now, 30)).toBe(false);
    });
});
