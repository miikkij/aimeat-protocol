/**
 * @file url-validator-dns.test.ts
 * @description The outbound SSRF guard against names, with both lookups under the test's control:
 *   the one validateOutboundUrl makes before the request (node:dns/promises) and the one that opens
 *   the socket (node:dns, through utils/outbound-connect-guard.ts).
 *   - A host name that starts with "127." is a name: under AIMEAT_ALLOW_PRIVATE_EGRESS it is resolved,
 *     and a private or metadata answer is refused (QA audit S4-01).
 *   - A name that answers a public address to the check and a loopback or private address to the
 *     connect (DNS rebinding) is refused at connect time and never reaches the listener; a name whose
 *     checked address is allowed connects to exactly that address (QA audit S4-02).
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit S4-01, S4-02).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** What each lookup answers, per host name. */
const precheck = new Map<string, string>();
const atConnect = new Map<string, string>();
const precheckCalls: string[] = [];

const familyOf = (a: string): number => (a.includes(':') ? 6 : 4);

vi.mock('node:dns/promises', async (orig) => {
    const real = await orig<typeof import('node:dns/promises')>();
    const lookup = async (host: string, opts?: unknown) => {
        precheckCalls.push(host);
        const a = precheck.get(host);
        if (!a) return real.lookup(host, opts as never);
        return [{ address: a, family: familyOf(a) }];
    };
    return { ...real, lookup, default: { ...real, lookup } };
});

vi.mock('node:dns', async (orig) => {
    const real = await orig<typeof import('node:dns')>();
    const lookup = (host: string, opts: unknown, cb: (e: Error | null, a: unknown, f?: number) => void) => {
        const a = atConnect.get(host);
        if (!a) { (real.lookup as unknown as (...x: unknown[]) => void)(host, opts, cb); return; }
        if ((opts as { all?: boolean })?.all) cb(null, [{ address: a, family: familyOf(a) }]);
        else cb(null, a, familyOf(a));
    };
    return { ...real, lookup, default: { ...real, lookup } };
});

const { validateOutboundUrl, safeFetch } = await import('../../src/utils/url-validator.js');

let server: http.Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
    server = http.createServer((_req, res) => { hits++; res.end('inside'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });
afterEach(() => {
    precheck.clear(); atConnect.clear(); precheckCalls.length = 0; hits = 0;
    delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    delete process.env.AIMEAT_DEV_MODE;
});

describe('validateOutboundUrl — a name that starts with "127." is resolved (S4-01)', () => {
    for (const [answer, label] of [['169.254.169.254', 'the metadata address'], ['10.0.0.5', 'a private address'], ['100.64.0.1', 'a carrier-grade address']]) {
        it(`refuses 127.attacker.example resolving to ${label}, with private egress on`, async () => {
            process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
            precheck.set('127.attacker.example', answer);
            const r = await validateOutboundUrl('http://127.attacker.example/');
            expect(r.valid).toBe(false);
            expect(precheckCalls).toContain('127.attacker.example');
        });
    }

    it('lets a name through that resolves to loopback, with private egress on', async () => {
        process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
        precheck.set('127.local-tool.example', '127.0.0.1');
        expect((await validateOutboundUrl('http://127.local-tool.example/')).valid).toBe(true);
    });

    it('still lets a literal loopback address through with private egress on, and refuses it with it off', async () => {
        expect((await validateOutboundUrl('http://127.0.0.1/')).valid).toBe(false);
        process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
        expect((await validateOutboundUrl('http://127.0.0.1/')).valid).toBe(true);
        expect((await validateOutboundUrl('http://localhost/')).valid).toBe(true);
    });
});

describe('safeFetch — the connection goes to the address that was checked (S4-02)', () => {
    it('refuses a name that answers public to the check and loopback to the connect, and never reaches the listener', async () => {
        precheck.set('rebind.example', '93.184.216.34');
        atConnect.set('rebind.example', '127.0.0.1');
        await expect(safeFetch(`http://rebind.example:${port}/`)).rejects.toThrow(/Fetch blocked/);
        expect(hits).toBe(0);
    });

    it('refuses a rebind to a private address even with private egress on', async () => {
        process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
        precheck.set('rebind2.example', '93.184.216.34');
        atConnect.set('rebind2.example', '10.0.0.5');
        await expect(safeFetch(`http://rebind2.example:${port}/`)).rejects.toThrow(/Fetch blocked/);
        expect(hits).toBe(0);
    });

    it('connects to the checked address: a name only the guard can resolve reaches the listener', async () => {
        process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
        precheck.set('pinned.example', '127.0.0.1');
        atConnect.set('pinned.example', '127.0.0.1');
        const resp = await safeFetch(`http://pinned.example:${port}/`);
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe('inside');
        expect(hits).toBe(1);
    });
});
