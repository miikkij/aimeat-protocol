/**
 * @file test/unit/package-sale-dispatch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The package sale tools on the CLI dispatch: each action of aimeat_package_sale and
 *   aimeat_package_buy reaches its own route with its own fields. cli-tool-param-forwarding probes one
 *   branch per tool; the branches it cannot hold open at the same time are measured here.
 * @usage pnpm test -- package-sale-dispatch
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import { describe, it, expect } from 'vitest';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { JsonObject } from '../../src/tool-dispatch/tool-call-helpers.js';

interface Sent { method: string; path: string; body?: unknown }

function run(name: string, input: JsonObject, answer: unknown = { ok: true, data: {} }): Promise<Sent[]> {
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`no dispatch entry for ${name}`);
    const sent: Sent[] = [];
    const push = (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return Promise.resolve(answer as never); };
    const client = {
        get: (p: string) => push('GET', p), post: (p: string, b?: unknown) => push('POST', p, b),
        put: (p: string, b?: unknown) => push('PUT', p, b), patch: (p: string, b?: unknown) => push('PATCH', p, b),
        delete: (p: string) => push('DELETE', p),
    };
    const ctx = { client, config: { agent: 'probe', owner: 'prober', node_url: 'http://node.test' }, agentPath: 'probe' };
    return (tool.handler(ctx as never, input) as Promise<unknown>).then(() => sent);
}

describe('aimeat_package_sale on the CLI dispatch', () => {
    it('price writes the catalogue entry with every price field', async () => {
        const sent = await run('aimeat_package_sale', {
            action: 'price', repository: 'repo-1', group_id: 'kit::alice',
            price: { amount: 49_000_000, currency: 'EUR' }, renewal: { amount: 9_000_000, currency: 'EUR', period_days: 365 },
            title: 'Kit', state: 'paused',
        });
        expect(sent).toEqual([{ method: 'PUT', path: '/v1/package-sales/catalogue', body: {
            repository: 'repo-1', group_id: 'kit::alice',
            price: { amount: 49_000_000, currency: 'EUR' }, renewal: { amount: 9_000_000, currency: 'EUR', period_days: 365 },
            title: 'Kit', state: 'paused',
        } }]);
    });

    it('price null is sent as null, the offer that grants without money', async () => {
        const sent = await run('aimeat_package_sale', { action: 'price', repository: 'repo-1', group_id: 'kit::alice', price: null as never });
        expect((sent[0].body as Record<string, unknown>).price).toBeNull();
    });

    it('decide posts the decision on the request', async () => {
        const sent = await run('aimeat_package_sale', { action: 'decide', request_id: 'req 1', decision: 'refuse' });
        expect(sent).toEqual([{ method: 'POST', path: '/v1/package-sales/requests/req%201/decision', body: { decision: 'refuse' } }]);
    });

    it('catalogue, requests and offer read their own routes', async () => {
        expect((await run('aimeat_package_sale', { action: 'catalogue' }))[0].path).toBe('/v1/package-sales/catalogue');
        expect((await run('aimeat_package_sale', { action: 'requests' }))[0].path).toBe('/v1/package-sales/requests');
        expect((await run('aimeat_package_sale', { action: 'offer', repository: 'repo-1', group_id: 'kit::alice' }))[0].path)
            .toBe('/v1/package-sales/author-offer?repository=repo-1&group_id=kit%3A%3Aalice');
    });

    it('claim puts the claim with the terms and no node', async () => {
        const sent = await run('aimeat_package_sale', {
            action: 'claim', repository: 'repo-1', group_id: 'kit::alice', terms_id: 't2', updates_until: '2027-10-02T00:00:00.000Z', note: 'order 7',
        });
        expect(sent).toEqual([{ method: 'PUT', path: '/v1/package-sales/claims', body: {
            repository: 'repo-1', group_id: 'kit::alice', terms_id: 't2', updates_until: '2027-10-02T00:00:00.000Z', note: 'order 7',
        } }]);
    });
});

describe('aimeat_package_buy on the CLI dispatch', () => {
    it('checkout reads the offer, then opens the checkout in its currency with a package line', async () => {
        const sent = await run('aimeat_package_buy', {
            action: 'checkout', repository: 'repo-1', group_id: 'kit::alice', node: { node_id: 'n2', url: 'http://n2', public_key: 'k' } as never, auto_renew: true,
        }, { ok: true, data: { buy: { currency: 'EUR' } } });
        expect(sent[0]).toEqual({ method: 'GET', path: '/v1/package-sales/offer?repository=repo-1&group_id=kit%3A%3Aalice' });
        expect(sent[1]).toEqual({ method: 'POST', path: '/v1/commerce/checkout-sessions', body: {
            currency: 'EUR',
            items: [{ kind: 'package', agent: 'repo-1', app: 'kit::alice', offer_id: 'buy', input: { node: { node_id: 'n2', url: 'http://n2', public_key: 'k' }, auto_renew: true } }],
        } });
    });

    it('a refused offer read opens no checkout', async () => {
        const sent = await run('aimeat_package_buy', { action: 'checkout', repository: 'repo-1', group_id: 'kit::alice' }, { ok: false, data: { error: { code: 'NOT_ON_SALE' } } });
        expect(sent).toHaveLength(1);
    });

    it('auto_renew puts the switch for one node', async () => {
        const sent = await run('aimeat_package_buy', { action: 'auto_renew', repository: 'repo-1', group_id: 'kit::alice', node_id: 'n2', auto_renew: false });
        expect(sent).toEqual([{ method: 'PUT', path: '/v1/package-sales/subscriptions/auto-renew', body: {
            repository: 'repo-1', group_id: 'kit::alice', node_id: 'n2', auto_renew: false,
        } }]);
    });
});
