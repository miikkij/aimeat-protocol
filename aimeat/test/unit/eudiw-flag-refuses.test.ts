/**
 * @file eudiw-flag-refuses.test.ts
 * @description A flag whose feature is half built must not be turnable on.
 *
 *   `services/sd-jwt.ts` verifies a credential's ISSUER signature and checks no holder binding and
 *   no nonce, so a presented credential is replayable and what it buys is an identity verification.
 *   `AIMEAT_EUDIW_ENABLED` defaults to false, which makes it dormant — and dormant is not safe,
 *   because a flag is a thing somebody turns on to try a wallet, and that person will not have read
 *   the file.
 *
 *   THIS TEST IS THE GUARD'S OWN ALARM. When holder binding is built, the guard is deleted and this
 *   test goes with it; until then, a change that removes the refusal fails here rather than shipping
 *   a way to enable a replayable login.
 *
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial, with the guard.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { assertEudiwNotHalfBuilt } from '../../src/config-eudiw-guard.js';

const KEY = 'AIMEAT_EUDIW_ENABLED';

describe('AIMEAT_EUDIW_ENABLED refuses to turn on', () => {
    afterEach(() => { delete process.env[KEY]; });

    it('throws when the flag is on', () => {
        process.env[KEY] = 'true';
        expect(() => assertEudiwNotHalfBuilt()).toThrow();
    });

    it('and the message says what is missing and that the flag is for development', () => {
        process.env[KEY] = 'true';
        let message = '';
        try { assertEudiwNotHalfBuilt(); } catch (err) { message = (err as Error).message; }
        // The message is the specification of what has to be true before the guard is deleted, so
        // these are the three things it must actually name.
        expect(message).toContain('holder binding');
        expect(message).toContain('nonce');
        expect(message).toContain('replayed');
        expect(message).toContain('development');
        expect(message).toContain('src/config-eudiw-guard.ts');
    });

    it('is silent when the flag is off, absent, or anything but the exact string', () => {
        delete process.env[KEY];
        expect(() => assertEudiwNotHalfBuilt()).not.toThrow();
        for (const v of ['false', '', '1', 'TRUE', 'yes']) {
            process.env[KEY] = v;
            expect(() => assertEudiwNotHalfBuilt(), `value ${JSON.stringify(v)}`).not.toThrow();
        }
    });

    it('and loadConfig is where it fires, beside the node-type refusal', async () => {
        // The guard belongs on the boot path, not in a module nothing calls. If somebody removes the
        // call from loadConfig, the function above still passes its own tests and the node starts.
        const { loadConfig } = await import('../../src/config.js');
        process.env[KEY] = 'true';
        expect(() => loadConfig()).toThrow(/holder binding/);
    });
});
