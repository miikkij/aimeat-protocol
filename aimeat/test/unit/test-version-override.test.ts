/**
 * @file test-version-override.test.ts
 * @description AIMEAT_TEST_SOFTWARE_VERSION (src/utils/version.ts testVersionOverride) makes a TEST
 *   node run as another version, and no other node. A test node is one with AIMEAT_TEST_MODE=true and
 *   a loopback public URL, the signal utils/test-money-guard.ts already reads. It exists so an E2E
 *   sweep can run the code as 4.0.0, every *_REMOVED_IN gate closed, before 4.0.0 is cut; on a node
 *   anyone else can reach it must change nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/test-version-override.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 */
import { describe, it, expect } from 'vitest';
import { testVersionOverride } from '../../src/utils/version.js';

const testNode = { AIMEAT_TEST_MODE: 'true', AIMEAT_BASE_URL: 'http://localhost:40376', AIMEAT_TEST_SOFTWARE_VERSION: '4.0.0' };

describe('AIMEAT_TEST_SOFTWARE_VERSION reaches a loopback test node only', () => {
    it('a test node on localhost, *.localhost, 127.x or [::1] runs as the version asked for', () => {
        for (const url of ['http://localhost:40376', 'http://sandbox.localhost:40600', 'http://127.0.0.1:40251', 'http://[::1]:40251']) {
            expect(testVersionOverride({ ...testNode, AIMEAT_BASE_URL: url }), url).toBe('4.0.0');
        }
    });

    it('a node others can reach keeps its own version, test mode or not', () => {
        for (const url of ['https://aimeat.io', 'http://192.168.1.10:40050', 'http://10.0.0.5', 'https://localhost.example.com', '']) {
            expect(testVersionOverride({ ...testNode, AIMEAT_BASE_URL: url }), url).toBeNull();
        }
    });

    it('without test mode the variable is ignored, even on localhost', () => {
        expect(testVersionOverride({ ...testNode, AIMEAT_TEST_MODE: undefined })).toBeNull();
        expect(testVersionOverride({ ...testNode, AIMEAT_TEST_MODE: 'false' })).toBeNull();
    });

    it('a value that is not a plain x.y.z version is ignored', () => {
        for (const v of ['', ' ', '4', '4.0', 'v4.0.0', '4.0.0-rc.1', '999.0.0; rm']) {
            expect(testVersionOverride({ ...testNode, AIMEAT_TEST_SOFTWARE_VERSION: v }), v).toBeNull();
        }
        expect(testVersionOverride({ AIMEAT_TEST_MODE: 'true', AIMEAT_BASE_URL: 'http://localhost:1' })).toBeNull();
    });
});
