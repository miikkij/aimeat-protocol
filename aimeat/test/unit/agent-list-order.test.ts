/**
 * @file test/unit/agent-list-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The order every agent list and picker shows (public/js/services/agents.js): the name a
 *   person sees (display name, else name, else GAII), compared in the reader's alphabet, and
 *   listAgents returning that order although GET /v1/agents answers in creation order.
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenttilistat-aakkosj-rjestykseen).
 */
import { describe, it, expect, vi } from 'vitest';

// The reader's chosen format decides the alphabet (format.js tag()); Finnish puts ä after z.
vi.mock('/js/display-prefs.js', () => ({ getRegion: () => 'fi-FI', getTimeZone: () => 'Europe/Helsinki' }));
vi.mock('/js/i18n.js', () => ({ t: (k: string) => k, getLocale: () => 'fi' }));
vi.mock('/js/swallowed.js', () => ({ swallowed: vi.fn() }));
const rows = [
    { name: 'zeta-writer', display_name: 'zeta-writer', owner: 'alice' },
    { name: 'orava', display_name: 'Ääni-orava', owner: 'alice' },
    { name: 'analyst', owner: 'alice' },
    { name: 'claude-desk', display_name: 'Claude Desktop', owner: 'alice' },
    { name: 'bob-bot', owner: 'bob' },
];
vi.mock('/js/api.js', () => ({
    apiGet: vi.fn(async () => ({ data: { agents: rows } })),
    apiPost: vi.fn(), apiDelete: vi.fn(), api: vi.fn(),
}));

const { listAgents, sortAgents, agentLabel } = await import('../../public/js/services/agents.js');

describe('agent list order', () => {
    it('names an agent by its display name, then its name, then its GAII', () => {
        expect(agentLabel({ display_name: 'Claude Desktop', name: 'claude-desk' })).toBe('Claude Desktop');
        expect(agentLabel({ name: 'analyst' })).toBe('analyst');
        expect(agentLabel({ gaii: 'x#alice@n' })).toBe('x#alice@n');
        expect(agentLabel(null)).toBe('');
    });

    it('listAgents returns the owner\'s agents in alphabetical order of the shown name', async () => {
        const list = await listAgents('alice');
        expect(list.map(agentLabel)).toEqual(['analyst', 'Claude Desktop', 'zeta-writer', 'Ääni-orava']);
    });

    it('sorts a copy and never the caller\'s array', () => {
        const input = [...rows];
        const sorted = sortAgents(input);
        expect(input.map((a) => a.name)).toEqual(rows.map((a) => a.name));
        expect(sorted).not.toBe(input);
    });

    it('answers an empty list for anything that is not a list', () => {
        expect(sortAgents(undefined as unknown as [])).toEqual([]);
    });
});
