/**
 * @file subdomain-node-labels.test.ts
 * @description The node's own apex labels (src/services/subdomain-node-labels.ts): which single-label
 *   names a published app never gets and the apex never serves as an app, and where the apex sends
 *   an app row that already holds one (its per-app origin) (secaudit2026oct22).
 * @usage cd aimeat && pnpm exec vitest run test/unit/subdomain-node-labels.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Created (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { isNodeApexLabel, nodeLabelAppOrigin } from '../../src/services/subdomain-node-labels.js';

const PROD = { baseUrl: 'https://aimeat.io', appHost: 'apps.aimeat.io', portfolioHost: 'portfolio.aimeat.io', coHost: 'co.aimeat.io', pageHost: 'pages.aimeat.io' };

describe('isNodeApexLabel', () => {
    it('names the sign-in, account, payment and support labels', () => {
        for (const l of ['login', 'signin', 'auth', 'sso', 'id', 'account', 'pay', 'billing', 'support']) {
            expect(isNodeApexLabel(l, PROD)).toBe(true);
        }
    });

    it('names the label of a configured node host that is not one of the fixed names', () => {
        const custom = { ...PROD, appHost: 'run.aimeat.io', coHost: 'firms.aimeat.io' };
        expect(isNodeApexLabel('run', custom)).toBe(true);
        expect(isNodeApexLabel('firms', custom)).toBe(true);
        expect(isNodeApexLabel('run', PROD)).toBe(false);
    });

    it('leaves ordinary app labels free', () => {
        for (const l of ['origin-demo', 'notes', 'budget-planner', 'alice-login', 'login-2']) {
            expect(isNodeApexLabel(l, PROD)).toBe(false);
        }
    });

    it('does not read a host family from a baseUrl that has no host', () => {
        expect(isNodeApexLabel('apps', { baseUrl: 'not a url', appHost: 'apps.example', portfolioHost: '', coHost: '', pageHost: '' })).toBe(false);
    });
});

describe('nodeLabelAppOrigin', () => {
    it('is the per-app origin, with the request\'s path and query', () => {
        expect(nodeLabelAppOrigin({ ...PROD, appOriginEnabled: true }, 'login', '/?x=1')).toBe('https://login.apps.aimeat.io/?x=1');
        expect(nodeLabelAppOrigin({ baseUrl: 'http://localhost:40050', appHost: 'apps.aimeat.test', appOriginEnabled: true }, 'login', '/'))
            .toBe('http://login.apps.aimeat.test:40050/');
    });

    it('is null when the node has no app origin', () => {
        expect(nodeLabelAppOrigin({ ...PROD, appOriginEnabled: false }, 'login', '/')).toBeNull();
        expect(nodeLabelAppOrigin({ baseUrl: 'https://aimeat.io', appHost: '', appOriginEnabled: true }, 'login', '/')).toBeNull();
    });
});
