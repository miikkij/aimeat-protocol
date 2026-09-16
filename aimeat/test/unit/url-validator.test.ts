/**
 * @file url-validator.test.ts
 * @description Unit tests for the SSRF guard (H-3): blocklist coverage (private,
 *   loopback, link-local/metadata, CGNAT, IPv4-mapped IPv6) and safeFetch's
 *   redirect re-validation (an allowed host must not be able to 3xx-bounce to an
 *   internal target).
 * @version-history
 *   v1.1.0 — 2026-09-06 — stripTrailingSlashes, including the input that made the regex it replaces
 *     quadratic: a long run of slashes with one character after it, which can never match.
 *   v1.0.0 — 2026-06-20 — Initial creation alongside the H-3 SSRF hardening.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateOutboundUrl, safeFetch, stripTrailingSlashes } from '../../src/utils/url-validator.js';

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AIMEAT_DEV_MODE;
});

describe('validateOutboundUrl — blocked literal addresses', () => {
    const blocked = [
        'http://127.0.0.1/',
        'http://127.1.2.3/',
        'http://10.0.0.5/',
        'http://172.16.0.1/',
        'http://192.168.1.1/',
        'http://169.254.169.254/latest/meta-data/', // cloud metadata
        'http://100.64.0.1/',   // CGNAT
        'http://100.127.255.1/',// CGNAT upper bound
        'http://0.0.0.0/',
        'http://[::1]/',        // IPv6 loopback
        'http://[::ffff:127.0.0.1]/', // IPv4-mapped IPv6 loopback
        'http://[fc00::1]/',    // unique-local
        'http://[fe80::1]/',    // link-local
        'http://localhost/',
        'http://sub.localhost/',
    ];
    for (const url of blocked) {
        it(`blocks ${url}`, async () => {
            const r = await validateOutboundUrl(url);
            expect(r.valid).toBe(false);
        });
    }

    it('blocks non-http(s) protocols', async () => {
        expect((await validateOutboundUrl('file:///etc/passwd')).valid).toBe(false);
        expect((await validateOutboundUrl('gopher://127.0.0.1/')).valid).toBe(false);
    });

    it('rejects malformed input', async () => {
        expect((await validateOutboundUrl('not a url')).valid).toBe(false);
    });

    it('allows loopback only in dev mode', async () => {
        expect((await validateOutboundUrl('http://127.0.0.1/')).valid).toBe(false);
        process.env.AIMEAT_DEV_MODE = 'true';
        expect((await validateOutboundUrl('http://127.0.0.1/')).valid).toBe(true);
    });
});

describe('safeFetch — redirect re-validation', () => {
    it('throws on an outright blocked URL without fetching', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        await expect(safeFetch('http://169.254.169.254/')).rejects.toThrow(/Fetch blocked/);
        expect(spy).not.toHaveBeenCalled();
    });

    it('blocks a redirect that points at an internal address', async () => {
        // First hop: a public-looking host (mock fetch returns a 302 → metadata IP).
        // safeFetch must re-validate the Location and refuse to follow it.
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
        );
        // Use a literal public IP as the start so the initial validation passes
        // without real DNS, then assert the redirect target is rejected.
        await expect(safeFetch('http://93.184.216.34/')).rejects.toThrow(/Fetch blocked/);
        // It should have fetched the first hop exactly once, then stopped.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    });

    it('returns a non-redirect response unchanged', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
        const resp = await safeFetch('http://93.184.216.34/');
        expect(resp.status).toBe(200);
        expect(await resp.text()).toBe('ok');
    });
});

describe('safeFetch — what a redirect to another host carries', () => {
    const A = 'http://93.184.216.34/start';
    const B = 'http://93.184.216.35/landing';
    function redirectThenOk(status: number, location: string) {
        return vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status, headers: { location } }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    }
    const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers);

    it('drops Authorization, Cookie and Proxy-Authorization on a redirect to another host, even when the caller named none', async () => {
        // An A2A push target's credential went out in Authorization with no sensitiveHeaders, and a
        // 302 handed it to the next host.
        const spy = redirectThenOk(302, B);
        await safeFetch(A, { headers: { Authorization: 'Bearer push-secret', Cookie: 's=1', 'Proxy-Authorization': 'Basic x', Accept: 'text/plain' } });
        const second = headersOf(spy.mock.calls[1]);
        expect(second.get('authorization')).toBeNull();
        expect(second.get('cookie')).toBeNull();
        expect(second.get('proxy-authorization')).toBeNull();
        expect(second.get('accept')).toBe('text/plain');
    });

    it('keeps the headers on a redirect within the same origin', async () => {
        const spy = redirectThenOk(302, 'http://93.184.216.34/other');
        await safeFetch(A, { headers: { Authorization: 'Bearer same-origin' } });
        expect(headersOf(spy.mock.calls[1]).get('authorization')).toBe('Bearer same-origin');
    });

    it('turns a POST into a GET without a body on 301, 302 and 303, as fetch does', async () => {
        // An OAuth token call carries client_secret or a refresh token in its body, and every hop
        // repeated it.
        for (const status of [301, 302, 303]) {
            vi.restoreAllMocks();
            const spy = redirectThenOk(status, B);
            await safeFetch(A, { method: 'POST', body: 'client_secret=s3cret', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            const second = spy.mock.calls[1][1] as RequestInit;
            expect(second.method, `status ${status}`).toBe('GET');
            expect(second.body, `status ${status}`).toBeUndefined();
            expect(new Headers(second.headers).get('content-type'), `status ${status}`).toBeNull();
        }
    });

    it('refuses to resend a body to another host on 307 or 308', async () => {
        for (const status of [307, 308]) {
            vi.restoreAllMocks();
            redirectThenOk(status, B);
            await expect(safeFetch(A, { method: 'POST', body: 'refresh_token=r' }), `status ${status}`).rejects.toThrow(/Fetch blocked/);
        }
    });

    it('still follows a 308 that only upgrades the same host to https, body and all', async () => {
        const spy = redirectThenOk(308, 'https://93.184.216.34/start');
        await safeFetch(A, { method: 'POST', body: 'payload' });
        const second = spy.mock.calls[1][1] as RequestInit;
        expect(second.method).toBe('POST');
        expect(second.body).toBe('payload');
    });
});

describe('stripTrailingSlashes', () => {
    it('takes off a run of trailing slashes and touches nothing else', () => {
        expect(stripTrailingSlashes('https://node.example')).toBe('https://node.example');
        expect(stripTrailingSlashes('https://node.example/')).toBe('https://node.example');
        expect(stripTrailingSlashes('https://node.example///')).toBe('https://node.example');
        expect(stripTrailingSlashes('https://node.example/v1/packages/')).toBe('https://node.example/v1/packages');
        expect(stripTrailingSlashes('')).toBe('');
        expect(stripTrailingSlashes('////')).toBe('');
    });

    it('answers in linear time on the input that made the regex quadratic', () => {
        // 200k trailing slashes with a character after them, so the pattern can never match and has
        // to give up from every position. `replace(/\/+$/, '')` is where a caller-supplied address
        // stalled the process; this must return, and quickly.
        const hostile = `https://node.example${'/'.repeat(200_000)}x`;
        const started = Date.now();
        expect(stripTrailingSlashes(hostile)).toBe(hostile);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
