/**
 * @file url-validator.test.ts
 * @description Unit tests for the SSRF guard (H-3): blocklist coverage (private,
 *   loopback, link-local/metadata, CGNAT, IPv4-mapped IPv6) and safeFetch's
 *   redirect re-validation (an allowed host must not be able to 3xx-bounce to an
 *   internal target).
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial creation alongside the H-3 SSRF hardening.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateOutboundUrl, safeFetch } from '../../src/utils/url-validator.js';

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
