/**
 * @file test/unit/home-feed-shown.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description homeFeedAsShown (src/services/home-feed.ts): the home's rows as the person sees them,
 *   which GET /v1/home/feed and aimeat_home_feed both answer. On crew71 the chat answered from the raw
 *   rows, '"morning-digest" -agentti' and '0,0078 $ kulunut', which the home hides for a buyer.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { homeFeedAsShown, type FeedItem } from '../../src/services/home-feed.js';
import { notePersonZone } from '../../src/services/person-zone.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const storage = {
    getGHIIByOwner: async () => null,
    getAgentsByOwner: async () => [
        { name: 'morning-digest', displayName: 'Aamukatsaus' },
        { name: 'plain', displayName: '' },
        // As crew71 holds it: the runtime rewrote the tags, so crew.basic is gone and the name decides.
        { name: 'concierge', displayName: 'Concierge', tags: ['concierge', 'chat', 'vision', 'web-search'] },
    ],
} as unknown as Storage;

const rows: FeedItem[] = [
    { kind: 'agent_task_done', at: '2026-11-02T05:00:00Z', link: null, data: { agent: 'morning-digest', title: 'Aamukatsaus' } },
    { kind: 'agent_connected', at: '2026-11-02T04:00:00Z', link: null, data: { name: 'plain' } },
    { kind: 'ai_spend_daily', at: '2026-11-01T23:59:00Z', link: null, data: { amount: '$0.0078', day: '2026-11-01' } },
];

const config = (purchasePlan: string) => ({ siteLinks: { purchasePlan } }) as unknown as AimeatConfig;

describe('homeFeedAsShown', () => {
    it('names an agent by the name the Agents page shows, and leaves a row whose agent has none as it was', async () => {
        const out = await homeFeedAsShown(storage, config(''), 'alice', { items: rows, total: 3 });
        expect(out.items[0].data).toEqual({ agent: 'morning-digest', title: 'Aamukatsaus', agent_shown_name: 'Aamukatsaus' });
        expect(out.items[1].data).toEqual({ name: 'plain' });
    });

    it('on a sold node, the short name gives way to the shown name in every field', async () => {
        const out = await homeFeedAsShown(storage, config('solo'), 'alice', { items: rows, total: 3 });
        expect(out.items[0].data).toEqual({ agent_shown_name: 'Aamukatsaus', agent: 'Aamukatsaus', title: 'Aamukatsaus' });
        expect(JSON.stringify(out)).not.toContain('morning-digest');
    });

    it('gives each row its time on the clock the person\'s browser last sent, and none before it sent one', async () => {
        const before = await homeFeedAsShown(storage, config(''), 'bob', { items: rows, total: 3 });
        expect(before.items[0].at_local).toBeUndefined();
        notePersonZone('bob', 'Europe/Helsinki');
        notePersonZone('bob', 'Not/AZone');
        const fi = await homeFeedAsShown(storage, { siteLinks: { purchasePlan: '', defaultLocale: 'fi' } } as unknown as AimeatConfig, 'bob', { items: rows, total: 3 });
        // 05:00 UTC is 7.00 in Helsinki in November, written as Finnish writes it.
        expect(fi.items[0].at_local).toBe('2.11. klo 7.00');
    });

    it('leaves out that an agent the node runs itself joined, and keeps its work', async () => {
        const items: FeedItem[] = [
            { kind: 'agent_connected', at: '2026-11-02T03:00:00Z', link: null, data: { name: 'concierge' } },
            { kind: 'agent_task_done', at: '2026-11-02T03:10:00Z', link: null, data: { agent: 'concierge', title: 'x' } },
        ];
        const out = await homeFeedAsShown(storage, config(''), 'alice', { items, total: 2 });
        expect(out.items.map((i) => i.kind)).toEqual(['agent_task_done']);
    });

    it('leaves out the day\'s AI cost row on a node the store sold, and keeps it elsewhere', async () => {
        const sold = await homeFeedAsShown(storage, config('solo'), 'alice', { items: rows, total: 3 });
        expect(sold.items.map((i) => i.kind)).toEqual(['agent_task_done', 'agent_connected']);
        expect(sold.total).toBe(2);
        const own = await homeFeedAsShown(storage, config(''), 'alice', { items: rows, total: 3 });
        expect(own.items.map((i) => i.kind)).toContain('ai_spend_daily');
    });
});
