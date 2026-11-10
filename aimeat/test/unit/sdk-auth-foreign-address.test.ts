/**
 * @file sdk-auth-foreign-address.test.ts
 * @description The sign-in dialog and a full AIMEAT address of another node (`name@node-id`).
 *
 *   THE CASE. On a store node a password manager filled in the person's address from their own
 *   node on the parent domain. The emailed-link step took it as an email (the browser's
 *   type="email" needs no dot) and answered "we sent a link", so nothing ever came; the password
 *   step showed the node's own "Cannot reach home node …". The dialog now refuses a non-email in
 *   the link step and, in the password step, says what to type instead.
 *
 *   FIRST FAIL: against modal-constants.js v1.1.0 foreignAddressText does not exist, and against
 *   http.js v1.1.0 the thrown error carries no status.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-foreign-address.test.ts
 * @version-history
 *   2026-11-10 — Initial.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

beforeAll(() => {
    // The SDK's config module reads the page on import: the node address from a meta tag or the location.
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).document = { querySelector: () => null, cookie: '' };
    (globalThis as any).location = new URL('https://node.test/');
});

afterEach(() => { vi.unstubAllGlobals(); });

const ADDRESS = 'alice@aimeat-other-node';

describe('another node\'s full address in the sign-in dialog', () => {
    it('is not an email address', async () => {
        const { EMAIL_RE } = await import('../../src/static/sdk-libs/auth/modal-constants.js');
        expect(EMAIL_RE.test(ADDRESS)).toBe(false);
        expect(EMAIL_RE.test('alice@example.com')).toBe(true);
    });

    it('gets a sentence naming the username to type when this node has no route to that node', async () => {
        const { foreignAddressText } = await import('../../src/static/sdk-libs/auth/modal-constants.js');
        const text = foreignAddressText({}, ADDRESS, { code: 'FEDERATION_UNREACHABLE', status: 400 });
        expect(text).toContain(ADDRESS);
        expect(text).toContain('(perhaps alice)');
        expect(foreignAddressText({}, ADDRESS, { code: 'FEDERATION_AUTH_DISABLED', status: 403 })).toContain('another AIMEAT');
        expect(foreignAddressText({}, ADDRESS, { code: 'FEDERATION_AUTH_NOT_ALLOWED', status: 403 })).toContain('another AIMEAT');
    });

    it('takes the dialog\'s language when the dictionary has the string', async () => {
        const { foreignAddressText } = await import('../../src/static/sdk-libs/auth/modal-constants.js');
        const i = { errForeignAddress: '{address} on tili toisessa AIMEATissa (ehkä {name}).' };
        expect(foreignAddressText(i, ADDRESS, { code: 'FEDERATION_UNREACHABLE', status: 400 }))
            .toBe('alice@aimeat-other-node on tili toisessa AIMEATissa (ehkä alice).');
    });

    it('leaves a home node that did not answer, and a wrong password, to their own words', async () => {
        const { foreignAddressText } = await import('../../src/static/sdk-libs/auth/modal-constants.js');
        expect(foreignAddressText({}, ADDRESS, { code: 'FEDERATION_UNREACHABLE', status: 504 })).toBeNull();
        expect(foreignAddressText({}, ADDRESS, { code: 'FEDERATION_UNREACHABLE', status: 502 })).toBeNull();
        expect(foreignAddressText({}, ADDRESS, { code: 'FEDERATION_AUTH_FAILED', status: 401 })).toBeNull();
    });

    it('a refused request carries its HTTP status', async () => {
        vi.stubGlobal('fetch', async () => ({
            status: 400,
            json: async () => ({ ok: false, error: { code: 'FEDERATION_UNREACHABLE', message: 'Cannot reach home node x.' } }),
        }));
        const { api } = await import('../../src/static/sdk-libs/auth/http.js');
        const err: any = await api('/v1/ghii/login', { method: 'POST', body: '{}' }).catch(e => e);
        expect(err.code).toBe('FEDERATION_UNREACHABLE');
        expect(err.status).toBe(400);
    });
});
