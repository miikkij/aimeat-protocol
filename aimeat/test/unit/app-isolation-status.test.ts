/**
 * @file app-isolation-status.test.ts
 * @description The operator's line about apps (audit A7-1): what the Security page and
 *   aimeat_admin_security_overview say for each of the three ways a node keeps apps apart, and that
 *   the warning and the settings appear only on a node several people share with no app addresses.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-isolation-status.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isolationStatusFor, appIsolationStatus } from '../../src/services/app-isolation-status.js';
import { resetAppIsolationCache } from '../../src/services/app-isolation.js';

const owners = (...names: string[]) => ({ listOwners: async () => names.map(name => ({ name })) }) as any;

describe('the apps line of the security overview', () => {
    beforeEach(() => resetAppIsolationCache());

    it('with an app origin: healthy, nothing to set', () => {
        const s = isolationStatusFor({ isolation: 'app-origin', people: 40, appOriginEnabled: true, appHost: 'apps.example.com', baseUrl: 'https://example.com' });
        expect(s.zone).toBe('healthy');
        expect(s.summary).toContain('apps.example.com');
        expect([s.warning, s.what_to_set, s.settings]).toEqual([null, null, null]);
    });
    it('one person without an app origin: watch, a package\'s app is framed, and the two settings that give apps addresses', () => {
        // Every app is meant to have an address of its own (Jouni, 2026-10-04), so this node is told how.
        const s = isolationStatusFor({ isolation: 'shared-origin', people: 1, appOriginEnabled: false, appHost: 'apps.place.example', baseUrl: 'https://place.example' });
        expect(s.zone).toBe('watch');
        expect(s.summary).toContain('An app a package installed runs in an isolated frame');
        expect(s.summary).toContain('When a second person gets an account');
        expect(s.warning).toBeNull();
        expect(s.settings).toEqual({ AIMEAT_APP_HOST: 'apps.place.example', AIMEAT_APP_ORIGIN_ENABLED: 'true' });
    });
    it('several people without an app origin: a warning, and the two settings with this node\'s values', () => {
        const s = isolationStatusFor({ isolation: 'isolated-frame', people: 12, appOriginEnabled: false, appHost: 'apps.intra.example', baseUrl: 'https://intra.example' });
        expect(s.zone).toBe('watch');
        expect(s.summary).toMatch(/^12 people /);
        expect(s.warning).toBeTruthy();
        expect(s.what_to_set).toContain('AIMEAT_APP_HOST=apps.intra.example');
        expect(s.what_to_set).toContain('AIMEAT_APP_ORIGIN_ENABLED=true');
        expect(s.settings).toEqual({ AIMEAT_APP_HOST: 'apps.intra.example', AIMEAT_APP_ORIGIN_ENABLED: 'true' });
    });
    it('on localhost the suggested host is a placeholder the operator replaces', () => {
        const s = isolationStatusFor({ isolation: 'isolated-frame', people: 2, appOriginEnabled: false, appHost: '', baseUrl: 'http://localhost:40050' });
        expect(s.settings?.AIMEAT_APP_HOST).toBe('apps.your-domain.example');
    });
    it('reads this node: the people counted fresh, the anonymous identity left out', async () => {
        const config = { appOriginEnabled: false, appHost: '', baseUrl: 'http://localhost:40050' } as any;
        expect((await appIsolationStatus(config, owners('a', 'anonymous'))).isolation).toBe('shared-origin');
        const shared = await appIsolationStatus(config, owners('a', 'b', 'anonymous'));
        expect(shared.isolation).toBe('isolated-frame');
        expect(shared.people).toBe(2);
    });
});
